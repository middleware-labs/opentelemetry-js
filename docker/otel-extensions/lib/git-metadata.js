'use strict';
// Reads commit SHA / origin URL straight out of a `.git` directory, without
// shelling out to `git` or depending on a git implementation library.
const fs = require('fs');
const path = require('path');

// Files under a gitdir that are never ref names, even though they sit
// alongside refs at the top level (e.g. a bare `HEAD` ref lookup must not
// accidentally match the `.git/config` file).
const GIT_FILES = ['config', 'description', 'index', 'shallow', 'commondir'];

function refCandidatePaths(ref) {
  return [
    ref,
    `refs/${ref}`,
    `refs/tags/${ref}`,
    `refs/heads/${ref}`,
    `refs/remotes/${ref}`,
    `refs/remotes/${ref}/HEAD`,
  ];
}

function parsePackedRefs(text) {
  const refs = new Map();
  if (!text) return refs;

  let previousRef = null;
  for (const line of text.trim().split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (line.startsWith('^')) {
      // The peeled oid of the annotated tag immediately preceding this line.
      if (previousRef) refs.set(`${previousRef}^{}`, line.slice(1));
      continue;
    }
    const separator = line.indexOf(' ');
    if (separator === -1) continue;
    const oid = line.slice(0, separator);
    const ref = line.slice(separator + 1);
    refs.set(ref, oid);
    previousRef = ref;
  }
  return refs;
}

function readPackedRefs(gitdir) {
  try {
    return parsePackedRefs(
      fs.readFileSync(path.join(gitdir, 'packed-refs'), 'utf8')
    );
  } catch {
    return new Map();
  }
}

function resolveRefInternal(gitdir, ref) {
  if (ref.startsWith('ref: ')) {
    return resolveRefInternal(gitdir, ref.slice('ref: '.length));
  }
  if (/^[0-9a-f]{40}$/.test(ref)) {
    return ref;
  }

  const packedRefs = readPackedRefs(gitdir);
  for (const candidate of refCandidatePaths(ref)) {
    if (GIT_FILES.includes(candidate)) continue;

    let contents;
    try {
      contents = fs.readFileSync(path.join(gitdir, candidate), 'utf8');
    } catch {
      contents = packedRefs.get(candidate);
    }
    if (contents) {
      return resolveRefInternal(gitdir, contents.trim());
    }
  }

  throw new Error(`Could not resolve ref "${ref}"`);
}

/** Resolves `HEAD` (or another ref) to a commit SHA for the repo at `repoDir`. */
function resolveRef(repoDir, ref) {
  return resolveRefInternal(path.join(repoDir, '.git'), ref);
}

// Minimal parser for the subset of git-config syntax needed to read
// `[remote "<name>"] url = ...`: sections/subsections, quoted values, and
// trailing comments. See `git help config` for the full grammar.
const SECTION_LINE_REGEX = /^\[([A-Za-z0-9-.]+)(?: "(.*)")?\]$/;
const VARIABLE_LINE_REGEX = /^([A-Za-z][A-Za-z-]*)(?: *= *(.*))?$/;
const TRAILING_COMMENT_REGEX = /^(.*?)( *[#;].*)$/;

function hasOddNumberOfQuotes(text) {
  return (text.match(/(?:^|[^\\])"/g) || []).length % 2 !== 0;
}

function stripTrailingComment(rawValue) {
  const match = TRAILING_COMMENT_REGEX.exec(rawValue);
  if (!match) return rawValue;
  const [, value, comment] = match;
  // An odd number of quotes on both sides means the "comment" text is
  // actually inside a quoted value (e.g. `url = "https://x#y"`).
  if (hasOddNumberOfQuotes(value) && hasOddNumberOfQuotes(comment)) {
    return `${value}${comment}`;
  }
  return value;
}

function unquote(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') continue;
    if (c === '\\' && text[i + 1] === '"') continue;
    result += c;
  }
  return result;
}

function listRemoteUrls(configText) {
  const remotes = new Map();
  let currentRemote = null;

  for (const rawLine of configText.split('\n')) {
    const line = rawLine.trim();

    const sectionMatch = SECTION_LINE_REGEX.exec(line);
    if (sectionMatch) {
      const [, section, subsection] = sectionMatch;
      currentRemote = section.toLowerCase() === 'remote' ? subsection : null;
      continue;
    }

    if (!currentRemote) continue;
    const variableMatch = VARIABLE_LINE_REGEX.exec(line);
    if (!variableMatch) continue;

    const [, name, rawValue = 'true'] = variableMatch;
    if (name.toLowerCase() !== 'url') continue;

    remotes.set(currentRemote, unquote(stripTrailingComment(rawValue)));
  }

  return remotes;
}

/** Returns the `remote.origin.url` configured for the repo at `repoDir`, if any. */
function resolveOriginUrl(repoDir) {
  let configText;
  try {
    configText = fs.readFileSync(path.join(repoDir, '.git', 'config'), 'utf8');
  } catch {
    return undefined;
  }
  return listRemoteUrls(configText).get('origin');
}

/** Walks up from `startDir` looking for a directory containing `.git`. */
function findGitRoot(startDir) {
  let dir = startDir;
  for (;;) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) {
        return dir;
      }
    } catch {
      // ignore and keep walking up
    }
    const parentDir = path.dirname(dir);
    if (parentDir === dir) return undefined;
    dir = parentDir;
  }
}

module.exports = { resolveRef, resolveOriginUrl, findGitRoot };
