/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExceptionStackFrame } from '../node/exceptionStackDetails';

export type { ExceptionStackFrame };

/**
 * No-op in the browser: expanding a stack frame requires reading the
 * originating source file off disk, which browsers have no access to.
 */
export function buildExceptionStackDetails(
  _stack: string
): ExceptionStackFrame[] | undefined {
  return undefined;
}
