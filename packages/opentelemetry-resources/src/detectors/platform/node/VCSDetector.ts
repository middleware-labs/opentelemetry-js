/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStringFromEnv } from '@opentelemetry/core';
import type { ResourceDetectionConfig } from '../../../config';
import type {
  DetectedResource,
  DetectedResourceAttributes,
  ResourceDetector,
} from '../../../types';
import {
  findGitRoot,
  resolveOriginUrl,
  resolveRef,
} from './vcs/gitMetadata';

const ATTR_VCS_COMMIT_SHA = 'vcs.commit_sha';
const ATTR_VCS_REPOSITORY_URL = 'vcs.repository_url';

interface VCSMetadata {
  sha?: string;
  url?: string;
}

let cached: VCSMetadata | undefined;

function stripGitSuffix(url: string): string {
  return url.replace(/\.git$/, '');
}

/**
 * Resolves VCS metadata from `MW_VCS_COMMIT_SHA` / `MW_VCS_REPOSITORY_URL`,
 * falling back to the local `.git` directory (starting from `process.cwd()`)
 * when either is unset. Cached at module scope: the git lookup only needs
 * to run once per process, however many providers/pipelines detect it.
 */
function resolveVCSMetadata(): VCSMetadata {
  if (cached) return cached;

  let sha = getStringFromEnv('MW_VCS_COMMIT_SHA');
  let url = getStringFromEnv('MW_VCS_REPOSITORY_URL');

  if (!sha || !url) {
    const repoDir = findGitRoot(process.cwd());
    if (repoDir) {
      if (!sha) {
        try {
          sha = resolveRef(repoDir, 'HEAD');
        } catch {
          // no resolvable HEAD (e.g. a repo with no commits yet)
        }
      }
      if (!url) {
        url = resolveOriginUrl(repoDir);
        if (url) url = stripGitSuffix(url);
      }
    }
  }

  cached = { sha, url };
  return cached;
}

/**
 * VCSDetector detects version-control metadata (commit SHA, repository URL)
 * from the `MW_VCS_COMMIT_SHA` / `MW_VCS_REPOSITORY_URL` environment
 * variables, or, absent those, from the local `.git` directory.
 */
class VCSDetector implements ResourceDetector {
  detect(_config?: ResourceDetectionConfig): DetectedResource {
    const { sha, url } = resolveVCSMetadata();

    const attributes: DetectedResourceAttributes = {};
    if (sha) attributes[ATTR_VCS_COMMIT_SHA] = sha;
    if (url) attributes[ATTR_VCS_REPOSITORY_URL] = url;

    return { attributes };
  }
}

export const vcsDetector = new VCSDetector();

/** @internal Exposed only so tests can reset the module-level cache. */
export function __resetVCSDetectorCacheForTests(): void {
  cached = undefined;
}
