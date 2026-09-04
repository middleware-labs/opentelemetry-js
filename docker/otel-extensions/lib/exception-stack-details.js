'use strict';
const fs = require('fs');

// Matches a V8 stack frame line, e.g.:
//   "    at Foo.bar (/path/to/file.js:12:34)"
//   "    at /path/to/file.js:12:34"
const STACK_FRAME_REGEX = /^\s*at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/;

// Number of source lines captured before/after the frame's line.
const SOURCE_CONTEXT_LINES = 10;

// Defaults for the size guards. Unlike the in-SDK version, attributes added
// from a SpanProcessor bypass the span's attributeValueLengthLimit, so this
// module caps itself rather than inheriting a limit.
const DEFAULT_MAX_FRAMES = 20;
const DEFAULT_MAX_ATTRIBUTE_LENGTH = 131072; // 128 KiB

function isSourceSnapshotEnabled() {
  return process.env.MW_RECORD_EXCEPTION_SOURCE !== 'false';
}

function readSourceContext(filePath, lineNumber) {
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
// "node:internal/...") are intentionally left unresolved rather than guessed
// at via module resolution.
function resolveFramePath(filePath) {
  const isAbsolute =
    filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath);
  if (!isAbsolute) return undefined;
  return fs.existsSync(filePath) ? filePath : undefined;
}

/**
 * Parses an `error.stack` string into a per-frame breakdown (file, line,
 * column, function name, whether the frame is in `node_modules`) and, unless
 * disabled via `MW_RECORD_EXCEPTION_SOURCE=false`, a snapshot of the source
 * around each frame's line.
 *
 * Never throws: unreadable or unparsable frames are skipped rather than
 * failing the whole extraction.
 */
function buildExceptionStackDetails(stack, options = {}) {
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;

  try {
    const captureSource = isSourceSnapshotEnabled();
    const stackDetails = [];

    for (const line of stack.split('\n').slice(1)) {
      if (stackDetails.length >= maxFrames) break;

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
  } catch {
    return undefined;
  }
}

/**
 * Serializes frames to the attribute value, dropping the deepest frames until
 * it fits the byte budget. Frames are ordered outermost-first (the throw site
 * is frame 0), so trimming from the end sheds the least useful context first.
 */
function serializeStackDetails(frames, options = {}) {
  const maxLength = options.maxAttributeLength ?? DEFAULT_MAX_ATTRIBUTE_LENGTH;

  let kept = frames;
  let serialized = JSON.stringify(kept);

  while (serialized.length > maxLength && kept.length > 1) {
    kept = kept.slice(0, -1);
    serialized = JSON.stringify(kept);
  }

  // A single frame can still exceed the budget if its source body is huge.
  if (serialized.length > maxLength) {
    const [frame] = kept;
    const { 'exception.function_body': _body, ...rest } = frame;
    serialized = JSON.stringify([rest]);
  }

  return serialized;
}

module.exports = { buildExceptionStackDetails, serializeStackDetails };
