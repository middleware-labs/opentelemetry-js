'use strict';
// Zero-code bootstrap for the init container. Deliberately NOT a symlink to
// @opentelemetry/auto-instrumentations-node's own register.js: that file
// carries its own private copy of getResourceDetectorsFromEnv() (needed
// there for cloud-provider detectors like AWS/GCP that live outside this
// monorepo) and never calls into @opentelemetry/sdk-node, so it can't see
// vcsDetector no matter what OTEL_NODE_RESOURCE_DETECTORS says. This file
// wires the same getNodeAutoInstrumentations() into a NodeSDK we construct
// ourselves, so the resource detector list -- and therefore the vcs
// resource detector this fork added -- is ours to control.
//
// register.js (upstream, no vcs detector) is still shipped alongside this
// file for anyone who wants the unmodified behavior.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const {
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  serviceInstanceIdDetector,
  vcsDetector,
} = require('@opentelemetry/resources');
const { diag, DiagConsoleLogger } = require('@opentelemetry/api');
const { getStringFromEnv, diagLogLevelFromString } = require('@opentelemetry/core');

const logLevel = getStringFromEnv('OTEL_LOG_LEVEL');
if (logLevel != null) {
  diag.setLogger(new DiagConsoleLogger(), {
    logLevel: diagLogLevelFromString(logLevel),
  });
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
