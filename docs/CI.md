# CI checks

[English README](../README.md) · [简体中文说明](../README.zh-CN.md)

## Automatic checks

[CI workflow](../.github/workflows/ci.yml) runs on pushes, pull requests, manual dispatch, and weekly on Mondays at 08:23 UTC. It can also be called as a reusable workflow.

| Layer                             | Checks                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static quality                    | Runtime and automation syntax, repository Prettier formatting, GitHub Actions workflow linting.                                                                           |
| Unit/regression                   | Evidence projection, privacy/redaction, summary coordination, model settings, history reconstruction, highlighting, diffs, and workspace evidence.                        |
| Integration                       | Host registration/RPC, client interactions, native Review navigation, full-file capture, and behavior summaries using test doubles.                                       |
| Platform/Node matrix              | Both test groups on Linux, macOS, and Windows, using Node.js 22 and 24.                                                                                                   |
| Package consumer                  | Build a real tarball, verify included/excluded files, MIT metadata and bundle identity, install in a clean temporary consumer, and import the installed Host entry point. |
| DSH public-contract compatibility | Install official DSH `0.2.1-rc.2` and `latest` independently, then check public Host contracts, real projection integration, and client dependency/export metadata.       |

The current suite contains **95 unit/regression tests and 45 integration tests**. New root-level test files automatically join the unit group unless explicitly classified as integration in [the test runner](../scripts/run-tests.mjs).

## Compatibility boundaries

Compatibility is a **bounded contract smoke test**, not complete browser/desktop end-to-end acceptance. It does not start a DSH Web server, access a user's profile, or call a model. The mock integration tests do not prove real browser rendering. Full plugin lifecycle, storage/network/auth behavior, and browser service contracts are not covered by this smoke test.

Before claiming a version is fully compatible, manually verify installation, restart, sidebar opening, native Review, summary-model controls, and uninstall in an isolated DSH profile.

The moving `latest` check is intentionally required: upstream breaking changes should fail CI until investigated. Passing does not automatically widen the declared minimum DSH version.

## Local commands

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npm run test:unit
npm run test:integration
npm run test:package
```

`npm test` runs both unit and integration groups together. The package check creates a real tarball and clean consumer in the operating system's temporary directory. CI retains the checked tarball as the `npm-candidate` artifact for seven days; this does not publish anything to npm.

To check the real host contracts, install DSH into a separate temporary directory and supply that installation prefix:

```sh
host_dir="$(mktemp -d)"
npm install --prefix "$host_dir" --no-audit --no-fund @deepseek-ai/dsh@latest
npm run test:compatibility -- "$host_dir"
```

Repeat with `@deepseek-ai/dsh@0.2.1-rc.2` to check the minimum version. Use Node.js 24 to match the compatibility CI jobs. The installation directory must contain its own `node_modules`; do not point the checker at a real DSH profile.
