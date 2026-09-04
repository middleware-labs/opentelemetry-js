/*
 * Copyright The OpenTelemetry Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import { noopDetector } from '../../NoopDetector';

/**
 * No-op in the browser: there is no `.git` directory to read, and
 * `MW_VCS_COMMIT_SHA` / `MW_VCS_REPOSITORY_URL` are build-time, server-side
 * concerns rather than something a browser runtime can observe.
 */
export const vcsDetector = noopDetector;
