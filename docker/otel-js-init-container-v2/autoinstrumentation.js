'use strict';
// Zero-code bootstrap, built on a STOCK OpenTelemetry SDK from npm. Both
// Middleware features come from @middleware.io/otel-extensions via public
// extension points -- no SDK fork involved:
//   - vcs.commit_sha / vcs.repository_url  -> a ResourceDetector
//   - exception.stack_details              -> a SpanProcessor (onEnding)
const { NodeSDK } = require('@opentelemetry/sdk-node');
const {
  getNodeAutoInstrumentations,
} = require('@opentelemetry/auto-instrumentations-node');
const {
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  serviceInstanceIdDetector,
} = require('@opentelemetry/resources');
const { diag, DiagConsoleLogger } = require('@opentelemetry/api');
const { getStringFromEnv, diagLogLevelFromString } = require('@opentelemetry/core');
const {
  vcsDetector,
  ExceptionStackDetailsSpanProcessor,
} = require('@middleware.io/otel-extensions');

const logLevel = getStringFromEnv('OTEL_LOG_LEVEL');
if (logLevel != null) {
  diag.setLogger(new DiagConsoleLogger(), {
    logLevel: diagLogLevelFromString(logLevel),
  });
}

// NodeSDK's `spanProcessors` option REPLACES the ones it would otherwise
// derive from OTEL_TRACES_EXPORTER / OTEL_EXPORTER_OTLP_*, so the exporting
// processors have to be composed in alongside the enricher. That helper is
// internal to @opentelemetry/sdk-node; the package ships no "exports" map so
// the deep import resolves, and if a future SDK release moves it we log
// loudly here rather than silently dropping exception.stack_details.
let spanProcessors;
try {
  const {
    getSpanProcessorsFromEnv,
  } = require('@opentelemetry/sdk-node/build/src/utils.js');
  spanProcessors = [
    new ExceptionStackDetailsSpanProcessor(),
    ...getSpanProcessorsFromEnv(undefined),
  ];
} catch (error) {
  diag.error(
    '[middleware] Could not load getSpanProcessorsFromEnv from @opentelemetry/sdk-node. ' +
      'exception.stack_details will NOT be recorded. Telemetry will still be exported ' +
      'using the SDK default pipeline. This usually means the pinned @opentelemetry/sdk-node ' +
      'version moved that internal helper and this bootstrap needs updating.',
    error
  );
  spanProcessors = undefined;
}

const sdk = new NodeSDK({
  instrumentations: getNodeAutoInstrumentations(),
  resourceDetectors: [
    envDetector,
    hostDetector,
    osDetector,
    processDetector,
    serviceInstanceIdDetector,
    vcsDetector,
  ],
  ...(spanProcessors ? { spanProcessors } : {}),
});

try {
  sdk.start();
  diag.info(
    'middleware-labs otel-js auto-instrumentation started (exception.stack_details + vcs resource detector enabled)'
  );
} catch (error) {
  diag.error(
    'Error initializing OpenTelemetry SDK. Your application is not instrumented and will not produce telemetry',
    error
  );
}

async function shutdown() {
  try {
    await sdk.shutdown();
    diag.debug('OpenTelemetry SDK terminated');
  } catch (error) {
    diag.error('Error terminating OpenTelemetry SDK', error);
  }
}
process.on('SIGTERM', shutdown);
process.once('beforeExit', shutdown);
