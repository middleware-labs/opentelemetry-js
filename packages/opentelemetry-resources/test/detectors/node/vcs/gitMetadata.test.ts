/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findGitRoot,
  resolveOriginUrl,
  resolveRef,
} from '../../../../src/detectors/platform/node/vcs/gitMetadata';
import { describeNode } from '../../../util';

function makeTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-detector-test-'));
}

function writeGitFile(repoDir: string, relativePath: string, contents: string) {
  const filePath = path.join(repoDir, '.git', relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describeNode('git metadata resolution on Node.js', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeTmpRepo();
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe('findGitRoot', () => {
    it('finds a directory containing .git', () => {
      fs.mkdirSync(path.join(repoDir, '.git'));
      const nested = path.join(repoDir, 'a', 'b', 'c');
      fs.mkdirSync(nested, { recursive: true });

      assert.strictEqual(findGitRoot(nested), repoDir);
    });

    it('returns undefined when no .git directory exists up to the filesystem root', () => {
      const nested = path.join(repoDir, 'a', 'b');
      fs.mkdirSync(nested, { recursive: true });

      assert.strictEqual(findGitRoot(nested), undefined);
    });
  });

  describe('resolveRef', () => {
    it('resolves a symbolic HEAD to a loose ref', () => {
      writeGitFile(repoDir, 'HEAD', 'ref: refs/heads/main\n');
      writeGitFile(
        repoDir,
        'refs/heads/main',
        'abc123abc123abc123abc123abc123abc123abc1\n'
      );

      assert.strictEqual(
        resolveRef(repoDir, 'HEAD'),
        'abc123abc123abc123abc123abc123abc123abc1'
      );
    });

    it('resolves a detached HEAD (already a SHA) directly', () => {
      writeGitFile(
        repoDir,
        'HEAD',
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n'
      );

      assert.strictEqual(
        resolveRef(repoDir, 'HEAD'),
        'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
      );
    });

    it('falls back to packed-refs when the loose ref is missing', () => {
      writeGitFile(repoDir, 'HEAD', 'ref: refs/heads/main\n');
      writeGitFile(
        repoDir,
        'packed-refs',
        [
          '# pack-refs with: peeled fully-peeled sorted',
          'cafebabecafebabecafebabecafebabecafebabe refs/heads/main',
        ].join('\n')
      );

      assert.strictEqual(
        resolveRef(repoDir, 'HEAD'),
        'cafebabecafebabecafebabecafebabecafebabe'
      );
    });

    it('throws when the ref cannot be resolved', () => {
      writeGitFile(repoDir, 'HEAD', 'ref: refs/heads/main\n');
      assert.throws(() => resolveRef(repoDir, 'HEAD'));
    });
  });

  describe('resolveOriginUrl', () => {
    it('reads remote.origin.url from git config', () => {
      writeGitFile(
        repoDir,
        'config',
        [
          '[core]',
          '\trepositoryformatversion = 0',
          '[remote "origin"]',
          '\turl = https://github.com/middleware-labs/opentelemetry-js.git',
          '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        ].join('\n')
      );

      assert.strictEqual(
        resolveOriginUrl(repoDir),
        'https://github.com/middleware-labs/opentelemetry-js.git'
      );
    });

    it('handles quoted values and trailing comments', () => {
      writeGitFile(
        repoDir,
        'config',
        [
          '[remote "origin"]',
          '\turl = "https://github.com/middleware-labs/opentelemetry-js.git" # primary remote',
        ].join('\n')
      );

      assert.strictEqual(
        resolveOriginUrl(repoDir),
        'https://github.com/middleware-labs/opentelemetry-js.git'
      );
    });

    it('returns undefined when there is no origin remote', () => {
      writeGitFile(
        repoDir,
        'config',
        ['[remote "upstream"]', '\turl = https://example.com/upstream.git'].join(
          '\n'
        )
      );

      assert.strictEqual(resolveOriginUrl(repoDir), undefined);
    });

    it('returns undefined when there is no git config at all', () => {
      assert.strictEqual(resolveOriginUrl(repoDir), undefined);
    });
  });
});
