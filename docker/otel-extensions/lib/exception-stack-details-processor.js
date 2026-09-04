'use strict';
const {
  buildExceptionStackDetails,
  serializeStackDetails,
} = require('./exception-stack-details');

const EXCEPTION_EVENT_NAME = 'exception';
const ATTR_EXCEPTION_STACKTRACE = 'exception.stacktrace';
const ATTR_EXCEPTION_STACK_DETAILS = 'exception.stack_details';

/**
 * Enriches recorded `exception` events with `exception.stack_details`, an
 * expanded form of `exception.stacktrace` that adds per-frame file/line/
 * function metadata and a snapshot of the surrounding source.
 *
 * Uses `onEnding` rather than `onEnd` deliberately. Every processor's
 * `onEnding` runs before *any* processor's `onEnd`, so enrichment always
 * lands before an exporting processor serializes the span -- regardless of
 * the order processors were registered in. Doing this in `onEnd` instead
 * works only if this processor happens to be registered ahead of the
 * exporter, and fails silently otherwise.
 */
class ExceptionStackDetailsSpanProcessor {
  constructor(options = {}) {
    this._options = options;
  }

  onStart() {}

  onEnding(span) {
    try {
      for (const event of span.events) {
        if (event.name !== EXCEPTION_EVENT_NAME || !event.attributes) continue;
        if (event.attributes[ATTR_EXCEPTION_STACK_DETAILS]) continue;

        const stack = event.attributes[ATTR_EXCEPTION_STACKTRACE];
        if (typeof stack !== 'string') continue;

        const frames = buildExceptionStackDetails(stack, this._options);
        if (!frames) continue;

        event.attributes[ATTR_EXCEPTION_STACK_DETAILS] = serializeStackDetails(
          frames,
          this._options
        );
      }
    } catch {
      // Never let enrichment break span export.
    }
  }

  onEnd() {}

  forceFlush() {
    return Promise.resolve();
  }

  shutdown() {
    return Promise.resolve();
  }
}

module.exports = { ExceptionStackDetailsSpanProcessor };
