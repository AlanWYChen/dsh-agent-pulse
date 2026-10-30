# Development

[English README](../README.md) · [简体中文说明](../README.zh-CN.md)

## Local checks

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run format:check
```

Tests use Node's built-in test runner. `npm test` runs all root-level test files through a cross-platform enumerator; `npm run test:unit` and `npm run test:integration` run disjoint groups. New test files default to the unit group unless explicitly classified as integration. `npm run check` checks the syntax of the runtime JavaScript modules.

`npm run test:package` verifies a real tarball in a clean consumer. `npm run test:compatibility -- /path/to/isolated-host-install` checks the real DSH public contracts. See [CI checks](CI.md) for the platform/version matrix, coverage boundaries, and local commands.

Run `npm run format` to apply Prettier across source, tests, documentation, and configuration. JavaScript uses single quotes and otherwise follows Prettier defaults. Dependencies, caches, build output, package archives, and the npm-managed lockfile are excluded. Keep the English and Chinese READMEs aligned when changing user-facing behavior.

## Repository layout

Runtime modules and their tests remain at the repository root to preserve existing package exports and test commands. User-facing setup and features belong in the READMEs; detailed trust boundaries belong in [Privacy and evidence boundaries](PRIVACY.md).

| File                                                                      | Responsibility                                                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [index.js](../index.js)                                                   | Host registration, domain storage, owner-only RPC, and agent tools.                      |
| [engine.js](../engine.js)                                                 | Pure replayable evidence projection and claim filtering.                                 |
| [workspace.js](../workspace.js)                                           | Conservative recorded-comparison enrichment.                                             |
| [coordinator.js](../coordinator.js)                                       | Bounded summary queue, narrative cache, and event-driven watches.                        |
| [model-settings.js](../model-settings.js)                                 | Persisted summary-model policy and selection tool.                                       |
| [change-context.js](../change-context.js)                                 | Redacted model excerpts and browser evidence.                                            |
| [recorded-files.js](../recorded-files.js)                                 | Bounded whole-file capture from successful canonical tool results.                       |
| [full-file-context.js](../full-file-context.js)                           | Validated historical line reconstruction without disk reads.                             |
| [unified-diff.js](../unified-diff.js)                                     | Bounded line comparison retaining unchanged context.                                     |
| [syntax-highlight.js](../syntax-highlight.js)                             | Local text-token highlighting for legacy recorded-content previews.                      |
| [client.js](../client.js)                                                 | Native Review navigation, legacy sidebar previews, model selection, and debug details.   |
| [cordis.patch.yml](../cordis.patch.yml)                                   | Local bundle plugin-row declaration and initial configuration.                           |
| [English locale](../locale/en.json) / [Chinese locale](../locale/zh.json) | Plugin title and description; main panel control dictionaries live in the client module. |

## Test coverage

Root-level `*.test.js` files cover evidence projection, summary coordination, configuration, privacy, workspace enrichment, recorded files, historical context reconstruction, unified diffs, highlighting, client behavior, and native Review integration.

When modifying evidence or summaries, retain tests for failed/denied tools, stale or partial verification, redaction, missing historical context, and uncertain concurrent-agent attribution. Never replace missing historical evidence with a current-disk comparison.

## Run in DSH

Install this checkout's absolute directory using DSH `plugin_manager` → `install_bundle`, in the profile you actually use. The package is private/local; do not assume it is available from npm.

Updated Host-side JavaScript generations may require restarting the **existing** DSH runtime. Refreshing the page alone does not reload Host modules. Do not start a second Web server: a new server does not update the GUI already open in the browser. Do not promise automatic client reload unless the corresponding DSH development watcher is actually running.

## Packaging and attribution

The explicit `files` list in [package metadata](../package.json) determines the distributable bundle. Both READMEs, the documentation directory, and [Third-party notices](../THIRD-PARTY-NOTICES.md) are included. Tests, dependencies installed in the checkout, and local caches are not source deliverables in that list.

The plugin icon is original artwork. The working-state whale-tail outline is adapted from DSH's MIT-licensed chat indicator; animation and dots are authored for this plugin. No duplicate React runtime is included.
