'use strict';
const { resolveRef, resolveOriginUrl, findGitRoot } = require('./git-metadata');

const ATTR_VCS_COMMIT_SHA = 'vcs.commit_sha';
const ATTR_VCS_REPOSITORY_URL = 'vcs.repository_url';

let cached;

function getStringFromEnv(key) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === '') return undefined;
  return raw;
}

function stripGitSuffix(url) {
  return url.replace(/\.git$/, '');
}

/**
 * Resolves VCS metadata from `MW_VCS_COMMIT_SHA` / `MW_VCS_REPOSITORY_URL`,
 * falling back to the local `.git` directory (starting from `process.cwd()`)
 * when either is unset. Cached at module scope: the git lookup only needs to
 * run once per process, however many providers/pipelines detect it.
 */
function resolveVCSMetadata() {
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
 * A standard OpenTelemetry ResourceDetector -- pass it in the SDK's
 * `resourceDetectors` array. Requires no SDK modification.
 */
const vcsDetector = {
  detect() {
    const { sha, url } = resolveVCSMetadata();

    const attributes = {};
    if (sha) attributes[ATTR_VCS_COMMIT_SHA] = sha;
    if (url) attributes[ATTR_VCS_REPOSITORY_URL] = url;

    return { attributes };
  },
};

/** @internal Exposed only so tests can reset the module-level cache. */
function __resetVCSDetectorCache() {
  cached = undefined;
}

module.exports = { vcsDetector, __resetVCSDetectorCache };
