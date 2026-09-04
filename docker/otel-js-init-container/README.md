# otel-js init container (test build)

Builds a Kubernetes-Operator-compatible Node.js auto-instrumentation init
container image from **this checkout** of the fork, so the local changes
below actually run in instrumented pods instead of the published npm
versions:

- `exception.stack_details` on every recorded exception (`packages/sdk-trace`)
- the `vcs` resource detector -- `vcs.commit_sha` / `vcs.repository_url`
  from `MW_VCS_COMMIT_SHA` / `MW_VCS_REPOSITORY_URL`, or the local `.git`
  directory (`packages/opentelemetry-resources`,
  `experimental/packages/opentelemetry-sdk-node`)

Structurally this mirrors the real
[`autoinstrumentation/nodejs`](https://github.com/open-telemetry/opentelemetry-operator/blob/main/autoinstrumentation/nodejs)
image the OTel Operator ships, with `@opentelemetry/sdk-trace`,
`sdk-trace-base`, `sdk-trace-node`, `resources`, and `sdk-node` overridden to
this repo's local build. See `Dockerfile` for the stage-by-stage comments and
`autoinstrumentation.js` for why it doesn't just symlink to
`@opentelemetry/auto-instrumentations-node`'s own `register.js` (short
version: that file has its own private resource-detector list and can't see
the `vcs` detector no matter what).

## Build

```sh
# one-time, from repo root: the OTLP .proto files are a git submodule
git submodule update --init --recursive

docker build -f docker/otel-js-init-container/Dockerfile -t otel-js-init-container:test .
```

For a real app with a genuine bug (rather than the one-shot script below)
plus a ready-to-apply `deployment.yaml`, see `sample-app/README.md`.

## Test locally with plain `docker run` (no cluster needed)

This simulates exactly what the Operator does: an init container populates a
shared volume, the app container mounts it read-only and loads it via
`NODE_OPTIONS`.

```sh
docker volume create otel-init-vol

# 1. "init container" step: copy the bundle into the shared volume
docker run --rm -v otel-init-vol:/otel-auto-instrumentation-nodejs otel-js-init-container:test

# 2. "app container" step: mount it read-only, boot with NODE_OPTIONS
docker run --rm \
  -v otel-init-vol:/otel-auto-instrumentation-nodejs:ro \
  -v "$(pwd)/docker/otel-js-init-container/smoke-test/app.js":/app.js:ro \
  -e NODE_OPTIONS="--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js" \
  -e NODE_PATH=/otel-auto-instrumentation-nodejs/node_modules \
  -e OTEL_TRACES_EXPORTER=console \
  -e OTEL_METRICS_EXPORTER=none \
  -e OTEL_LOGS_EXPORTER=none \
  -e OTEL_SERVICE_NAME=smoke-test-app \
  -e MW_VCS_COMMIT_SHA=deadbeefcafebabedeadbeefcafebabedeadbeef \
  -e MW_VCS_REPOSITORY_URL=https://github.com/middleware-labs/opentelemetry-js \
  node:22-bookworm node /app.js
```

`smoke-test/app.js` doesn't depend on `@opentelemetry/api` itself -- it
resolves it via `NODE_PATH` pointing at the bundle, the same way a real app
that wants to manually enrich a span on top of zero-code instrumentation
would. Expect a console-exported span whose `resource.attributes` includes
`vcs.commit_sha`/`vcs.repository_url`, and whose `exception` event includes
`exception.stack_details` with `/app.js`'s real file/line/function-body.

Point `-v .../app.js:/app.js:ro` and the command at your own app instead to
test it for real (drop the `MW_VCS_*` env vars and it'll fall back to
whatever `.git` directory is baked into your app's own image, if any --
usually none in production, so setting them explicitly, e.g. from CI, is the
realistic path).

To disable the exception source-body disk read (it's on by default), add
`-e MW_RECORD_EXCEPTION_SOURCE=false`.

## Use with a real OTel Operator `Instrumentation` CR

Build, tag, and push this image to a registry your cluster can pull from,
then point the `Instrumentation` resource's `spec.nodejs.image` at it:

```sh
# one-time, from repo root
git submodule update --init --recursive

REGISTRY=<your-registry>      # e.g. ghcr.io/middleware-labs, or docker.io/<user>
IMAGE="$REGISTRY/otel-js-init-container"
TAG=test                      # e.g. a git short SHA for a traceable build

docker build \
  -f docker/otel-js-init-container/Dockerfile \
  -t "$IMAGE:$TAG" \
  .

docker push "$IMAGE:$TAG"
```

Then reference `$IMAGE:$TAG` below:

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: middleware-nodejs
spec:
  nodejs:
    image: <your-registry>/otel-js-init-container:test # $IMAGE:$TAG from above
  env:
    - name: OTEL_TRACES_EXPORTER
      value: otlp
    - name: MW_VCS_COMMIT_SHA
      value: <commit-sha>
    - name: MW_VCS_REPOSITORY_URL
      value: <repository-url>
```

The Operator's webhook handles the init container + `NODE_OPTIONS` injection
itself; you don't set those manually as you did in the local test above.

## Iterating on the SDK code

Rebuilding after a source change is just `docker build` again -- stage
`sdk-build` recompiles from the checkout, stage `build` re-packs the 5
overridden packages via `link-local-packages.sh` and reinstalls, and the
final `runtime` stage reassembles `/autoinstrumentation`. No manual `npm
pack`/version bumping needed between iterations.
