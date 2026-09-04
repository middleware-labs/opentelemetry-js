/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpanContext } from '@opentelemetry/api';
import { ROOT_CONTEXT, SpanKind, TraceFlags } from '@opentelemetry/api';
import * as assert from 'assert';
import { TracerProvider } from '../../src';
import { SpanImpl } from '../../src/Span';
import { ATTR_EXCEPTION_STACK_DETAILS } from '../../src/enums';
import type { Tracer } from '../../src/Tracer';
import { cheatSpanLimitsFromTracer } from '../common/util';

describe('Span#recordException stack_details (node)', () => {
  const tracer = new TracerProvider({
    spanLimits: {
      attributeValueLengthLimit: 10_000,
      attributeCountLimit: 100,
      eventCountLimit: 100,
    },
  }).getTracer('default') as Tracer;
  const spanContext: SpanContext = {
    traceId: 'd4cda95b652f4a1592b449d5929fda1b',
    spanId: '6e0c63257de34c92',
    traceFlags: TraceFlags.SAMPLED,
  };

  function newSpan(): SpanImpl {
    return new SpanImpl({
      scope: tracer.instrumentationScope,
      resource: tracer['_resource'],
      context: ROOT_CONTEXT,
      spanContext,
      name: 'span1',
      kind: SpanKind.CLIENT,
      spanLimits: cheatSpanLimitsFromTracer(tracer),
      spanProcessor: tracer['_spanProcessor'],
    });
  }

  it('adds exception.stack_details as a JSON string alongside exception.stacktrace', () => {
    const span = newSpan();

    let error: Error;
    try {
      throw new Error('boom');
    } catch (e) {
      error = e as Error;
    }

    span.recordException(error);

    const event = span.events[0];
    const raw = event.attributes?.[ATTR_EXCEPTION_STACK_DETAILS];
    assert.ok(typeof raw === 'string');

    const frames = JSON.parse(raw as string);
    assert.ok(Array.isArray(frames) && frames.length > 0);
    assert.strictEqual(frames[0]['exception.file'], __filename);
    assert.ok(frames[0]['exception.function_body']);
  });

  it('does not add exception.stack_details when the stack has no resolvable frames', () => {
    const span = newSpan();
    span.recordException({ name: 'Error', message: 'boom', stack: 'boom' });

    const event = span.events[0];
    assert.strictEqual(
      event.attributes?.[ATTR_EXCEPTION_STACK_DETAILS],
      undefined
    );
  });
});
