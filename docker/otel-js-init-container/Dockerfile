# Build from the repo root so stage `sdk-build` can see the whole monorepo:
#   docker build -f docker/otel-js-init-container/Dockerfile -t otel-js-init-container:test .
#
# Prerequisite on the host: the OTLP .proto files are a git submodule.
#   git submodule update --init --recursive
#
# Mirrors the real OTel Operator Node.js auto-instrumentation image:
#   https://github.com/open-telemetry/opentelemetry-operator/blob/main/autoinstrumentation/nodejs/Dockerfile
# with one addition: @opentelemetry/sdk-trace, sdk-trace-base, sdk-trace-node,
# resources, and sdk-node are pulled from THIS checkout instead of the
# published npm versions, so the local exception.stack_details (sdk-trace)
# and vcs resource detector (resources / sdk-node) changes are what actually
# runs inside instrumented pods.

##
## Stage 1: build this fork so the packages it modified have real build/
## output to pack in stage 2. (In the upstream Operator repo this stage
## doesn't exist -- the SDK is just a normal npm dependency there.)
##
FROM node:22-bookworm AS sdk-build
WORKDIR /repo
COPY . .
RUN test -d experimental/packages/otlp-transformer/protos/opentelemetry || \
    (echo "ERROR: git submodule not initialized on the host. Run: git submodule update --init --recursive, then retry the docker build." >&2 && exit 1)
RUN npm install
RUN npx tsc --build experimental/packages/opentelemetry-sdk-node/tsconfig.json

##
## Stage 2: assemble the auto-instrumentation bundle. Same shape as the
## Operator's own "build" stage: a small package.json depending on
## @opentelemetry/auto-instrumentations-node, `npm install`ed and copied
## into build/workspace via its postinstall script.
##
FROM node:22-bookworm AS build
WORKDIR /operator-build
COPY --from=sdk-build /repo /repo
COPY docker/otel-js-init-container/package.json docker/otel-js-init-container/link-local-packages.sh ./
RUN sh link-local-packages.sh /repo /repo/dist-tarballs
RUN npm install

##
## Stage 3: the image actually shipped as the init container -- identical
## in shape to the Operator's own final stage. Its only job at runtime is
## to `cp` /autoinstrumentation into a volume shared with the app
## container, which then loads it via
##   NODE_OPTIONS=--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js
##
FROM busybox AS runtime
COPY --from=build /operator-build/build/workspace /autoinstrumentation

# Backward compatibility with older operator versions that expect
# register.js (upstream, unmodified) at the top level rather than under
# node_modules.
RUN cp -r /autoinstrumentation/node_modules/@opentelemetry/auto-instrumentations-node/build/src/. /autoinstrumentation

# Our own bootstrap -- NOT a symlink to register.js. register.js carries its
# own private resource-detector list and never calls into
# @opentelemetry/sdk-node, so it can't see the vcs detector this fork added.
# See autoinstrumentation.js for the full explanation.
COPY docker/otel-js-init-container/autoinstrumentation.js /autoinstrumentation/autoinstrumentation.js

RUN chmod -R go+r /autoinstrumentation

# The real Operator always overrides this with its own copy command when it
# injects the init container, so this default only matters for `docker run`
# / local testing -- see docker/otel-js-init-container/README.md.
CMD ["cp", "-a", "/autoinstrumentation/.", "/otel-auto-instrumentation-nodejs/"]
