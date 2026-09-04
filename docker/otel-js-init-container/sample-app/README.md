# orders-api

A minimal Express app for verifying the `otel-js-init-container` image (see
`../README.md`) end to end -- zero-code, no `@opentelemetry/*` import
anywhere in `server.js`.

Routes:

- `GET /` -- basic info
- `GET /healthz` -- used by the k8s probes, kept separate from `/list` so a
  bug there never affects liveness/readiness
- `GET /list` -- lists orders. One seeded order is missing its `items`
  array (an easy oversight for a record created before `items` became
  required), and `/list` doesn't guard against it, so `summarizeOrder()`
  throws a genuine `TypeError: Cannot read properties of undefined (reading
  'length')` a few stack frames in -- nothing is thrown on purpose. Because
  the stack trace resolves to this app's own files (and `express`'s), it's
  a good target for checking `exception.stack_details` specifically -- an
  error from a failed outgoing connection, by contrast, is all
  `node:internal/...` frames with nothing to snapshot.

## Verify locally with `docker run` first (no cluster needed)

Reuses the same volume trick as `../README.md`'s smoke test, just with a
real app and a real bug instead of a one-shot script.

```sh
# from repo root

# 1. build both images
docker build -f docker/otel-js-init-container/Dockerfile -t otel-js-init-container:test .
docker build -f docker/otel-js-init-container/sample-app/Dockerfile -t orders-api:test docker/otel-js-init-container/sample-app

# 2. "init container" step: populate a shared volume
docker volume create otel-init-vol
docker run --rm -v otel-init-vol:/otel-auto-instrumentation-nodejs otel-js-init-container:test

# 3. "app container" step: mount it read-only, boot with NODE_OPTIONS
docker run -d --name orders-api-test \
  -v otel-init-vol:/otel-auto-instrumentation-nodejs:ro \
  -e NODE_OPTIONS="--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js" \
  -e NODE_PATH=/otel-auto-instrumentation-nodejs/node_modules \
  -e OTEL_TRACES_EXPORTER=console \
  -e OTEL_METRICS_EXPORTER=none \
  -e OTEL_LOGS_EXPORTER=none \
  -e OTEL_SERVICE_NAME=orders-api \
  -e MW_VCS_COMMIT_SHA=deadbeefcafebabedeadbeefcafebabedeadbeef \
  -e MW_VCS_REPOSITORY_URL=https://github.com/middleware-labs/opentelemetry-js \
  -p 3000:3000 \
  orders-api:test

# 4. hit the buggy endpoint, then read the exported spans
curl localhost:3000/list
docker logs orders-api-test

# cleanup
docker rm -f orders-api-test
docker volume rm otel-init-vol
```

Expect a `500` response, and in `docker logs` an `@opentelemetry/instrumentation-express`
span named `request handler - /list` whose `exception` event has an
`exception.stack_details` array of real `/app/server.js` and
`express/lib/router/*` frames (file, line, function name, source-body
snapshot), plus `vcs.commit_sha`/`vcs.repository_url` on every span's
`resource.attributes`.

## Deploy to a real cluster with the OTel Operator

Requires the OTel Operator already installed in the cluster.

```sh
# 1. build + push both images (see ../README.md for the init container)
docker build -f docker/otel-js-init-container/sample-app/Dockerfile \
  -t <your-registry>/orders-api:test \
  docker/otel-js-init-container/sample-app
docker push <your-registry>/orders-api:test

# 2. edit the <your-registry> / <commit-sha> / <repository-url> placeholders
#    in k8s/instrumentation.yaml and k8s/deployment.yaml, then apply
kubectl apply -f docker/otel-js-init-container/sample-app/k8s/instrumentation.yaml
kubectl apply -f docker/otel-js-init-container/sample-app/k8s/deployment.yaml

# 3. confirm the operator injected the init container + NODE_OPTIONS
kubectl describe pod -l app=orders-api | grep -A5 "Init Containers:"

# 4. hit /list and read the exported spans from the pod's own stdout
#    (OTEL_TRACES_EXPORTER=console in k8s/instrumentation.yaml -- swap for
#    `otlp` once you have a collector to point at)
kubectl port-forward svc/orders-api 3000:80 &
curl localhost:3000/list
kubectl logs -l app=orders-api
```

`k8s/deployment.yaml`'s pod template annotation
(`instrumentation.opentelemetry.io/inject-nodejs: "middleware-nodejs"`) is
what triggers the Operator's webhook to inject the init container and set
`NODE_OPTIONS` -- nothing about the app image itself needs to change between
"uninstrumented" and "instrumented".
