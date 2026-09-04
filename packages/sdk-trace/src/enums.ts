/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

// Event name definitions
export const ExceptionEventName = 'exception';

// Custom (non-semconv) exception attribute recorded alongside the
// standard `exception.*` attributes: a structured, per-frame expansion
// of `exception.stacktrace` produced by `buildExceptionStackDetails()`.
export const ATTR_EXCEPTION_STACK_DETAILS = 'exception.stack_details';
