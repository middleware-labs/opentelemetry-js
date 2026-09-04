'use strict';
// Minimal smoke test for the auto-instrumentation bundle. `@opentelemetry/api`
// isn't a dependency of this script itself -- it resolves via NODE_PATH
// pointing at the bundle's own node_modules, the same way a real app that
// wants to manually enrich a span (recordException, custom attributes) on
// top of zero-code auto-instrumentation would.
const { trace } = require('@opentelemetry/api');

function handlerThatThrows() {
  throw new Error('boom from smoke test');
}

const tracer = trace.getTracer('smoke-test');
const span = tracer.startSpan('smoke-test-span');
try {
  handlerThatThrows();
} catch (err) {
  span.recordException(err);
} finally {
  span.end();
}

// give the console exporter's batch processor a moment to flush before exit
setTimeout(() => process.exit(0), 1000);
