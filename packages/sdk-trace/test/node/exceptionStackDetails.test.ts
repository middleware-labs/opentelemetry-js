/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExceptionStackFrame } from '../../src/platform/node/exceptionStackDetails';
import { buildExceptionStackDetails } from '../../src/platform/node/exceptionStackDetails';

function parse(stack: string): ExceptionStackFrame[] | undefined {
  return buildExceptionStackDetails(stack);
}

describe('buildExceptionStackDetails', () => {
  const originalEnv = process.env.MW_RECORD_EXCEPTION_SOURCE;
  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MW_RECORD_EXCEPTION_SOURCE;
    } else {
      process.env.MW_RECORD_EXCEPTION_SOURCE = originalEnv;
    }
  });

  it('returns undefined for a stack with no resolvable frames', () => {
    assert.strictEqual(parse('Error: boom'), undefined);
    assert.strictEqual(parse('Error: boom\n    at <anonymous>'), undefined);
  });

  it('parses a real error thrown from this file', () => {
    let error: Error;
    try {
      throw new Error('boom');
    } catch (e) {
      error = e as Error;
    }

    const frames = parse(error.stack!);
    assert.ok(frames && frames.length > 0);

    const [frame] = frames!;
    assert.strictEqual(frame['exception.file'], __filename);
    assert.strictEqual(typeof frame['exception.line'], 'number');
    assert.strictEqual(typeof frame['exception.column_number'], 'number');
    assert.strictEqual(frame['exception.is_file_external'], false);
    assert.ok(frame['exception.function_name']);
    assert.ok(frame['exception.function_body']?.includes('boom'));
    assert.strictEqual(typeof frame['exception.start_line'], 'number');
    assert.strictEqual(typeof frame['exception.end_line'], 'number');
  });

  it('marks node_modules frames as external', () => {
    const nodeModulesDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'exception-stack-details-node_modules-')
    );
    const filePath = path.join(nodeModulesDir, 'index.js');
    fs.writeFileSync(filePath, '// dummy dependency file\n'.repeat(20));

    try {
      const stack = `Error: boom\n    at Object.<anonymous> (${filePath}:5:9)`;
      const frames = parse(stack);
      assert.ok(frames && frames.length === 1);
      assert.strictEqual(frames![0]['exception.is_file_external'], true);
    } finally {
      fs.rmSync(nodeModulesDir, { recursive: true, force: true });
    }
  });

  it('skips frames whose file does not exist on disk', () => {
    const stack = `Error: boom\n    at Object.<anonymous> (/definitely/not/a/real/file.js:1:1)`;
    assert.strictEqual(parse(stack), undefined);
  });

  it('omits function_body when MW_RECORD_EXCEPTION_SOURCE=false', () => {
    process.env.MW_RECORD_EXCEPTION_SOURCE = 'false';

    let error: Error;
    try {
      throw new Error('boom');
    } catch (e) {
      error = e as Error;
    }

    const frames = parse(error.stack!);
    assert.ok(frames && frames.length > 0);
    const [frame] = frames!;
    assert.strictEqual(frame['exception.function_body'], undefined);
    assert.strictEqual(frame['exception.start_line'], undefined);
    assert.strictEqual(frame['exception.end_line'], undefined);
    // frame identity is still captured regardless of the flag
    assert.strictEqual(frame['exception.file'], __filename);
  });

  it('captures function_body by default (MW_RECORD_EXCEPTION_SOURCE unset)', () => {
    delete process.env.MW_RECORD_EXCEPTION_SOURCE;

    let error: Error;
    try {
      throw new Error('boom');
    } catch (e) {
      error = e as Error;
    }

    const frames = parse(error.stack!);
    assert.ok(frames![0]['exception.function_body']);
  });
});
