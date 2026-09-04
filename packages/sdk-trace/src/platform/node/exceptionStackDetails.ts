/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import { diag } from '@opentelemetry/api';

/** One parsed frame of an exception's stack trace. */
export interface ExceptionStackFrame {
  'exception.file': string;
  'exception.line': number;
  'exception.column_number': number;
  'exception.function_name': string;
  'exception.is_file_external': boolean;
  'exception.function_body'?: string;
  'exception.start_line'?: number;
  'exception.end_line'?: number;
}

// Matches a V8 stack frame line, e.g.:
//   "    at Foo.bar (/path/to/file.js:12:34)"
//   "    at /path/to/file.js:12:34"
const STACK_FRAME_REGEX = /^\s*at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;

// Number of source lines captured before/after the frame's line.
const SOURCE_CONTEXT_LINES = 10;

/**
 * Whether source-code snapshotting (reading the frame's file off disk to
 * capture the surrounding function body) is enabled. Reading the env var
 * lazily (rather than once at module load) keeps this responsive to tests
 * and to runtimes that mutate `process.env` after startup.
 */
function isSourceSnapshotEnabled(): boolean {
  return process.env.MW_RECORD_EXCEPTION_SOURCE !== 'false';
}

function readSourceContext(
  filePath: string,
  lineNumber: number
): Pick<
  ExceptionStackFrame,
  'exception.function_body' | 'exception.start_line' | 'exception.end_line'
> {
  try {
    const source = fs.readFileSync(filePath, 'utf-8').split('\n');
    const startLine = Math.max(0, lineNumber - SOURCE_CONTEXT_LINES);
    const endLine = Math.min(source.length, lineNumber + SOURCE_CONTEXT_LINES);

    return {
      'exception.function_body': source.slice(startLine, endLine).join('\n'),
      'exception.start_line': startLine,
      'exception.end_line': endLine,
    };
  } catch {
    return {};
  }
}

// V8 stack frames report absolute file paths for both user code and
// `node_modules` dependencies; non-file frames (e.g. "<anonymous>",
// "node:internal/...") are intentionally left unresolved rather than
// guessed at via module resolution, since `require` isn't available in
// this package's ESM build output.
function resolveFramePath(filePath: string): string | undefined {
  const isAbsolute =
    filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
  if (!isAbsolute) return undefined;
  return fs.existsSync(filePath) ? filePath : undefined;
}

/**
 * Parses a `error.stack` string into a per-frame breakdown (file, line,
 * column, function name, whether the frame is in `node_modules`) and,
 * unless disabled via `MW_RECORD_EXCEPTION_SOURCE=false`, a snapshot of
 * the source around each frame's line.
 *
 * Never throws: unreadable or unparsable frames are skipped rather than
 * failing the whole extraction, since this runs on the exception-recording
 * hot path.
 */
export function buildExceptionStackDetails(
  stack: string
): ExceptionStackFrame[] | undefined {
  try {
    const captureSource = isSourceSnapshotEnabled();
    const frames = stack.split('\n').slice(1);
    const stackDetails: ExceptionStackFrame[] = [];

    for (const line of frames) {
      const match = line.match(STACK_FRAME_REGEX);
      if (!match) continue;

      const [, functionName, rawFilePath, lineNumber, columnNumber] = match;
      const resolvedPath = resolveFramePath(rawFilePath);
      if (!resolvedPath) continue;

      const parsedLineNumber = parseInt(lineNumber, 10);

      stackDetails.push({
        'exception.file': resolvedPath,
        'exception.line': parsedLineNumber,
        'exception.column_number': parseInt(columnNumber, 10),
        'exception.function_name': functionName || 'anonymous',
        'exception.is_file_external': resolvedPath.includes('node_modules'),
        ...(captureSource
          ? readSourceContext(resolvedPath, parsedLineNumber)
          : {}),
      });
    }

    return stackDetails.length > 0 ? stackDetails : undefined;
  } catch (error) {
    diag.warn('Failed to build exception stack details', error);
    return undefined;
  }
}
