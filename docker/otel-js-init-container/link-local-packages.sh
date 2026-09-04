#!/bin/sh
# Packs the packages this fork modified (from the full monorepo checkout at
# $REPO_DIR) into real tarballs, then points this directory's package.json
# `overrides` at them. Using tarballs rather than `file:<directory>`
# overrides matters: npm symlinks directory-based `file:` deps, and a
# symlink into $REPO_DIR would dangle once the final image stops copying
# $REPO_DIR forward. A packed tarball is extracted into a normal,
# self-contained node_modules entry instead.
set -eu

REPO_DIR="${1:?usage: link-local-packages.sh <repo-dir> <dist-dir>}"
DIST_DIR="${2:?usage: link-local-packages.sh <repo-dir> <dist-dir>}"

mkdir -p "$DIST_DIR"

pack() {
  pkg_name="$1"
  pkg_dir="$2"
  filename=$(cd "$REPO_DIR/$pkg_dir" && npm pack --loglevel=error --pack-destination "$DIST_DIR")
  npm pkg set "overrides[$pkg_name]=file:$DIST_DIR/$filename"
  echo "linked $pkg_name -> $DIST_DIR/$filename"
}

# The packages this fork carries local changes to (exception.stack_details
# in sdk-trace's recordException(), and the vcs resource detector +
# OTEL_NODE_RESOURCE_DETECTORS=vcs wiring in resources/sdk-node), plus their
# closest siblings in the same dependency family, packed together so the
# whole trace/resource stack resolves to one consistent local build instead
# of a mix of local + registry copies.
pack "@opentelemetry/sdk-trace" "packages/sdk-trace"
pack "@opentelemetry/sdk-trace-base" "packages/opentelemetry-sdk-trace-base"
pack "@opentelemetry/sdk-trace-node" "packages/opentelemetry-sdk-trace-node"
pack "@opentelemetry/resources" "packages/opentelemetry-resources"
pack "@opentelemetry/sdk-node" "experimental/packages/opentelemetry-sdk-node"
