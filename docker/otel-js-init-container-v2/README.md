# otel-js init container (v2 — stock SDK + extensions package)

Same init container as `../otel-js-init-container`, built a different way:
**nothing here forks or overrides the OpenTelemetry SDK.** Every
`@opentelemetry/*` package is the stock published release from npm, and the
Middleware behavior is added from `@middleware.io/otel-extensions`
(`../otel-extensions`) through two public extension points:

| feature | extension point | file |
|---|---|---|
| `vcs.commit_sha` / `vcs.repository_url` | `ResourceDetector` | `lib/vcs-detector.js` |
| `exception.stack_details` | `SpanProcessor.onEnding()` | `lib/exception-stack-details-processor.js` |

Both images are kept side by side so they can be compared before committing
to either approach.

## Verified equivalent

Running the same `../otel-js-init-container/sample-app` against both images
and diffing the exported `exception.stack_details` payload:

```
v1 (forked SDK)      frames: 8
v2 (stock SDK + ext) frames: 8
keys identical: true
payload byte-identical: true
```

## Build

```sh
# NOTE: build context is `docker`, not the repo root
docker build -f docker/otel-js-init-container-v2/Dockerfile -t otel-js-init-container:v2 docker
```

No `git submodule update`, no monorepo `npm install`, no `tsc`, no npm
`overrides` — the build context is just the `docker/` directory. Build takes
roughly a minute versus several for v1.

## Test it

Identical to v1 — see `../otel-js-init-container/sample-app/README.md`, just
swap the image name:

```sh
docker build -f docker/otel-js-init-container/sample-app/Dockerfile -t orders-api:test docker/otel-js-init-container/sample-app

docker volume create otel-v2-vol
docker run --rm -v otel-v2-vol:/otel-auto-instrumentation-nodejs otel-js-init-container:v2

docker run -d --name orders-api-v2 \
  -v otel-v2-vol:/otel-auto-instrumentation-nodejs:ro \
  -e NODE_OPTIONS="--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js" \
  -e NODE_PATH=/otel-auto-instrumentation-nodejs/node_modules \
  -e OTEL_TRACES_EXPORTER=console \
  -e OTEL_METRICS_EXPORTER=none \
  -e OTEL_LOGS_EXPORTER=none \
  -e OTEL_SERVICE_NAME=orders-api \
  -e MW_VCS_COMMIT_SHA=deadbeefcafebabedeadbeefcafebabedeadbeef \
  -e MW_VCS_REPOSITORY_URL=https://github.com/middleware-labs/opentelemetry-js \
  -p 3001:3000 \
  orders-api:test

curl localhost:3001/list
docker logs orders-api-v2

docker rm -f orders-api-v2 && docker volume rm otel-v2-vol
```

To confirm for yourself that the SDK really is unmodified:

```sh
docker run --rm --entrypoint sh otel-js-init-container:v2 -c '
  find /autoinstrumentation/node_modules/@opentelemetry -iname "*exceptionStackDetails*" -o -iname "*VCSDetector*"
  grep -rl "MW_RECORD_EXCEPTION_SOURCE\|vcs.commit_sha" /autoinstrumentation/node_modules/@opentelemetry/'
# both print nothing -- all Middleware code lives in
# /autoinstrumentation/node_modules/@middleware.io/otel-extensions
```

## Known differences from v1

1. **`onEnding`, not `onEnd`.** Enrichment must happen before an exporting
   processor serializes the span. Every processor's `onEnding` runs before
   *any* processor's `onEnd`, so this is order-independent; doing the same
   work in `onEnd` only works if this processor happens to be registered
   ahead of the exporter, and silently drops the attribute otherwise.
2. **Reads the recorded stacktrace, not the live `Error`.** The processor
   parses `exception.stacktrace` off the event. If you ever set
   `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT`, that string arrives already truncated
   and the tail frames are lost. The default is unlimited, so today the two
   are identical — but don't set that limit.
3. **Self-capped.** Attributes written from a processor bypass the span's
   `attributeValueLengthLimit`, so the package caps itself instead:
   20 frames and 128 KiB, both overridable via the constructor.
4. **One internal import.** `NodeSDK`'s `spanProcessors` option replaces the
   env-derived processors rather than merging, so `autoinstrumentation.js`
   deep-imports `getSpanProcessorsFromEnv` from `@opentelemetry/sdk-node` to
   compose them. It's not public API; `sdk-node` ships no `exports` map so it
   resolves today, and if a future release moves it the bootstrap logs a loud
   error and keeps exporting telemetry without `stack_details` rather than
   failing silently.

## If you adopt this

`../otel-extensions` moves to its own repo and gets published as
`@middleware.io/otel-extensions`; this Dockerfile then drops the `npm pack`
step and just depends on the published version. The
`middleware-labs/opentelemetry-js` fork — and the rebase burden with it — is
no longer needed, and the 13 modified upstream files can be reverted.

It's currently plain CommonJS with no build step, deliberately, so it's easy
to read and run. Porting it to TypeScript with the fork's existing test suite
is the obvious follow-up if it's adopted.
