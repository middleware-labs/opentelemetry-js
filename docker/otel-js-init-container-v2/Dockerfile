# Build with the `docker/` directory as the context (NOT the repo root):
#   docker build -f docker/otel-js-init-container-v2/Dockerfile -t otel-js-init-container:v2 docker
#
# Unlike the v1 image, nothing here builds or overrides the OpenTelemetry SDK.
# Every @opentelemetry/* package is the stock published release from npm; the
# Middleware behavior is added from @middleware.io/otel-extensions through
# public extension points (a ResourceDetector and a SpanProcessor). That means
# no monorepo build stage, no tsc, no git submodule, and no npm `overrides`.

##
## Stage 1: same shape as the OTel Operator's own build stage -- a small
## package.json, `npm install`, and a postinstall that stages node_modules
## into build/workspace.
##
FROM node:22-bookworm AS build
WORKDIR /operator-build

# Packed rather than referenced as `file:./extensions`, because npm symlinks
# directory-based file: deps and the symlink would dangle once the final
# stage stops carrying the source directory forward.
COPY otel-extensions/ ./extensions/
COPY otel-js-init-container-v2/package.json ./
RUN EXT_TGZ="$(cd extensions && npm pack --loglevel=error --pack-destination /operator-build)" \
    && npm pkg set "dependencies[@middleware.io/otel-extensions]=file:/operator-build/$EXT_TGZ" \
    && echo "linked @middleware.io/otel-extensions -> $EXT_TGZ"

RUN npm install

##
## Stage 2: the image shipped as the init container. Its only job at runtime
## is to `cp` /autoinstrumentation into a volume shared with the app
## container, which loads it via
##   NODE_OPTIONS=--require /otel-auto-instrumentation-nodejs/autoinstrumentation.js
##
FROM busybox AS runtime
COPY --from=build /operator-build/build/workspace /autoinstrumentation

# Backward compatibility with older operator versions that expect register.js
# (upstream, unmodified) at the top level rather than under node_modules.
RUN cp -r /autoinstrumentation/node_modules/@opentelemetry/auto-instrumentations-node/build/src/. /autoinstrumentation

# Our own bootstrap -- NOT a symlink to register.js, which builds its own
# NodeSDK with a private resource-detector list that can't see vcsDetector.
COPY otel-js-init-container-v2/autoinstrumentation.js /autoinstrumentation/autoinstrumentation.js

RUN chmod -R go+r /autoinstrumentation

# The real Operator overrides this with its own copy command when it injects
# the init container; this default is for `docker run` / local testing.
CMD ["cp", "-a", "/autoinstrumentation/.", "/otel-auto-instrumentation-nodejs/"]
