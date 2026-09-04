/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { vcsDetector } from '../../../src';
import { __resetVCSDetectorCacheForTests } from '../../../src/detectors/platform/node/VCSDetector';
import { describeNode } from '../../util';

function writeGitFile(repoDir: string, relativePath: string, contents: string) {
  const filePath = path.join(repoDir, '.git', relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describeNode('vcsDetector() on Node.js', () => {
  const originalSha = process.env.MW_VCS_COMMIT_SHA;
  const originalUrl = process.env.MW_VCS_REPOSITORY_URL;
  let repoDir: string;

  beforeEach(() => {
    __resetVCSDetectorCacheForTests();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcs-detector-test-'));
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(repoDir, { recursive: true, force: true });
    if (originalSha === undefined) delete process.env.MW_VCS_COMMIT_SHA;
    else process.env.MW_VCS_COMMIT_SHA = originalSha;
    if (originalUrl === undefined) delete process.env.MW_VCS_REPOSITORY_URL;
    else process.env.MW_VCS_REPOSITORY_URL = originalUrl;
    __resetVCSDetectorCacheForTests();
  });

  it('prefers MW_VCS_COMMIT_SHA / MW_VCS_REPOSITORY_URL over the local .git directory', () => {
    process.env.MW_VCS_COMMIT_SHA = 'env-sha';
    process.env.MW_VCS_REPOSITORY_URL = 'https://example.com/env-repo.git';
    sinon.stub(process, 'cwd').returns(repoDir);

    const { attributes } = vcsDetector.detect();
    assert.strictEqual(attributes?.['vcs.commit_sha'], 'env-sha');
    assert.strictEqual(
      attributes?.['vcs.repository_url'],
      'https://example.com/env-repo.git'
    );
  });

  it('falls back to the local .git directory when the env vars are unset', () => {
    delete process.env.MW_VCS_COMMIT_SHA;
    delete process.env.MW_VCS_REPOSITORY_URL;
    writeGitFile(
      repoDir,
      'HEAD',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n'
    );
    writeGitFile(
      repoDir,
      'config',
      [
        '[remote "origin"]',
        '\turl = https://github.com/middleware-labs/opentelemetry-js.git',
      ].join('\n')
    );
    sinon.stub(process, 'cwd').returns(repoDir);

    const { attributes } = vcsDetector.detect();
    assert.strictEqual(
      attributes?.['vcs.commit_sha'],
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    );
    assert.strictEqual(
      attributes?.['vcs.repository_url'],
      'https://github.com/middleware-labs/opentelemetry-js'
    );
  });

  it('returns no attributes when neither env vars nor a .git directory are present', () => {
    delete process.env.MW_VCS_COMMIT_SHA;
    delete process.env.MW_VCS_REPOSITORY_URL;
    sinon.stub(process, 'cwd').returns(repoDir);

    const { attributes } = vcsDetector.detect();
    assert.strictEqual(attributes?.['vcs.commit_sha'], undefined);
    assert.strictEqual(attributes?.['vcs.repository_url'], undefined);
  });

  it('caches the git-directory lookup across repeated detect() calls', () => {
    delete process.env.MW_VCS_COMMIT_SHA;
    delete process.env.MW_VCS_REPOSITORY_URL;
    writeGitFile(
      repoDir,
      'HEAD',
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n'
    );
    const cwdStub = sinon.stub(process, 'cwd').returns(repoDir);

    vcsDetector.detect();
    cwdStub.resetHistory();
    const { attributes } = vcsDetector.detect();

    assert.strictEqual(cwdStub.called, false);
    assert.strictEqual(
      attributes?.['vcs.commit_sha'],
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    );
  });
});
