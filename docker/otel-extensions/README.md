# @middleware.io/otel-extensions

Middleware's OpenTelemetry additions, implemented entirely against **public
OpenTelemetry extension points** — no SDK fork, no patching, no `overrides`.
Zero runtime dependencies.

```js
const {
  vcsDetector,
  ExceptionStackDetailsSpanProcessor,
} = require('@middleware.io/otel-extensions');

const sdk = new NodeSDK({
  resourceDetectors: [envDetector, hostDetector, processDetector, vcsDetector],
  spanProcessors: [new ExceptionStackDetailsSpanProcessor(), ...yourExporters],
});
```

## `vcsDetector`

A standard `ResourceDetector`. Adds:

- `vcs.commit_sha` — from `MW_VCS_COMMIT_SHA`, else `HEAD` resolved out of the
  local `.git` directory
- `vcs.repository_url` — from `MW_VCS_REPOSITORY_URL`, else `remote.origin.url`
  from `.git/config` (with any `.git` suffix stripped)

The `.git` reading is done by parsing the files directly (`lib/git-metadata.js`)
— no `git` binary and no git library dependency. It handles ref indirection,
`packed-refs`, and the quoting/comment rules of git-config. Resolution is
cached at module scope, so the lookup runs once per process no matter how many
providers detect it.

Production images usually don't ship `.git`, so setting the two environment
variables from CI is the realistic path; the `.git` fallback mainly helps in
dev and staging.

## `ExceptionStackDetailsSpanProcessor`

Adds `exception.stack_details` to recorded `exception` events — an expanded
form of `exception.stacktrace`. For each resolvable frame:

| key | |
|---|---|
| `exception.file` | absolute path |
| `exception.line` / `exception.column_number` | position |
| `exception.function_name` | or `anonymous` |
| `exception.is_file_external` | whether the frame is under `node_modules` |
| `exception.function_body` | ±10 lines of source around the frame |
| `exception.start_line` / `exception.end_line` | bounds of that snapshot |

Frames that don't resolve to a real file on disk (`node:internal/...`,
`<anonymous>`) are skipped, so an error thrown entirely inside Node core
produces no `stack_details` at all.

Set `MW_RECORD_EXCEPTION_SOURCE=false` to keep the frame metadata but skip
reading source files from disk.

### Why `onEnding`

Enrichment has to land before an exporting processor serializes the span.
Every processor's `onEnding` runs before *any* processor's `onEnd`, so this is
independent of the order processors were registered in. The same logic in
`onEnd` works only when this processor is registered ahead of the exporter and
**fails silently** otherwise — worth knowing, because an in-memory exporter
holds spans by reference and will make that bug look like it works in tests.

### Limits

Attributes written from a processor bypass the span's
`attributeValueLengthLimit`, so this caps itself: 20 frames and 128 KiB by
default. Override per instance:

```js
new ExceptionStackDetailsSpanProcessor({ maxFrames: 40, maxAttributeLength: 262144 });
```

When the serialized value exceeds the budget, the deepest frames are dropped
first — the throw site is frame 0, so the most useful context is kept.

### Caveat

The processor parses the recorded `exception.stacktrace` string, not the live
`Error`. If `OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT` is set, that string is already
truncated and tail frames are lost. The default is unlimited.
