<p align="center"><img src="icon.svg" width="96" height="96" alt="Agent Activity Intelligence icon"></p>

<div align="center">

# Agent Activity Intelligence

**English** · [简体中文](README.zh-CN.md)

**See what your agents changed—not a wall of tool calls.**

A native [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) sidebar for meaningful outcomes, observed test results, and sensitive-file access. Routine reads and web searches stay quiet.

[Highlights](#highlights) · [Prepare DSH](#prepare-dsh) · [Install](#install) · [All features](#all-features) · [Privacy](#privacy-and-limits) · [Development](#development)

</div>

## Highlights

| What you want to know              | What the plugin shows                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **What changed?**                  | Evolving cards per agent turn, with optional AI explanations of behavior changes and why they matter. |
| **Was it tested?**                 | Observed test counts and verification gaps—not a pass claim based only on a successful exit.          |
| **Did it access sensitive files?** | Distinct cards for successful, denied, or failed direct access to recognized sensitive paths.         |
| **What are my subagents doing?**   | The current session and observed local subagents in one feed, with a live working indicator.          |
| **Can I inspect the changes?**     | Click a changed file to open DSH's native **Review · turn N** in the right sidebar.                   |
| **Can I control summary costs?**   | Choose a summary model, follow each agent's model, or turn AI summaries off and keep factual cards.   |

## Prepare DSH

- Use **DSH `0.2.1-rc.2` or newer**, as declared by this plugin's package metadata. This is a minimum requirement, not a claim that every later release has been tested.
- Install or run DSH using the [official instructions](https://github.com/deepseek-ai/deepseek-harness#run). The visible sidebar requires the DSH Web GUI.
- For optional AI summaries, configure a model provider in DSH. **Factual activity cards and sensitive-access detection do not require a summary model.**
- For the source installation below, have Git, Node.js, and npm available; use a Node.js version supported by your DSH release.

## Install

This repository is currently a **private, local DSH bundle**, not a published npm package.

### 1. Get the source

```sh
git clone https://github.com/AlanWYChen/dsh-agent-pulse.git
cd dsh-agent-pulse
npm ci --ignore-scripts
pwd
```

Copy the absolute directory printed by `pwd`.

### 2. Install the bundle in your DSH profile

In the DSH instance you actually use, ask its agent:

```text
Install the local DSH plugin bundle at /absolute/path/to/dsh-agent-pulse
using plugin_manager → install_bundle.
```

Replace the example path with your checkout's absolute path. Installation applies to the **current DSH profile**, not just the conversation. Keep the source directory available for this local installation.

### 3. Open the feed

1. Follow DSH's restart prompt if one is shown, then refresh the existing DSH page.
2. Open **What changed** from the conversation header or right-sidebar guide.
3. Open **Settings → Summaries** to choose the summary model and effort, or **Off** for factual cards only. Effort defaults to the model's lowest supported setting. Following the chat model can be expensive.
4. Expand **Changes** and click a file to inspect its recorded native Review.

Host-side JavaScript updates may require restarting the existing DSH runtime; refreshing the browser alone does not reload Host modules. Do not start a second Web server to update your existing GUI.

## All features

### Activity and outcomes

| Feature                           | Behavior                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Turn-based change cards**       | Successful direct `edit` / `write` calls are grouped into an evolving card per agent turn. Failed modifications get attention cards, not change claims.          |
| **Workspace comparison evidence** | Adds shell-originated changes when DSH has recorded a comparison. Concurrent-agent attribution remains explicitly uncertain.                                     |
| **Behavior summaries**            | At a turn checkpoint, the selected model receives bounded, redacted change excerpts plus task context. It explains outcomes rather than listing file operations. |
| **Grounded narratives**           | Accepted summaries must refer to supplied change IDs. AI text has a source badge; counts and verification remain deterministic evidence.                         |
| **Graceful fallback**             | Missing models, rejected output, or provider failures leave factual cards available.                                                                             |
| **Local subagent aggregation**    | Includes observed local subagents; independent session forks are not grouped as subagents. Cached child cards are labeled historical.                            |
| **Live working state**            | Whale-tail indicator and DeepSeek's native shimmering working text/ellipsis, with reduced-motion support.                                                        |
| **Optional debug details**        | Off by default. Exposes a collapsed technical trace without changing what evidence the summary model receives.                                                   |

### Verification and sensitive access

| Feature                            | Behavior                                                                                                                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recognized test summaries**      | Numeric Node TAP/spec, pytest, Vitest, and Jest summaries from supported foreground commands. A zero exit code alone never supplies a pass count.                                                         |
| **Partial and stale verification** | Selected tests are labeled partial when their scope cannot cover all changed files. Later modifications stale earlier verification.                                                                       |
| **Sensitive-file alerts**          | Direct `read` / `read_image` access to recognized `.env` variants, SSH configuration/keys, credentials, and common secret-file extensions. Template/example `.env` files are excluded from access alerts. |
| **Distinct access outcomes**       | Successful access, denied attempts, and failed attempts are shown separately.                                                                                                                             |
| **Custom path rules**              | Add case-insensitive sensitive-path regular expressions and exclusions through plugin configuration.                                                                                                      |

### Review and summary controls

| Feature                            | Behavior                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native Review navigation**       | Opens the exact same-session/turn/path **Review · turn N** used by DSH's **Edited N files** card, selecting the clicked file.                                                                 |
| **Native editor experience**       | Keeps syntax colors, split/inline layout, file picker, wrapping, and editor menu. Missing native Review evidence produces an explicit error, not a substitute custom diff.                    |
| **Recorded-content compatibility** | Previously opened custom diff tabs remain readable. Bounded, redacted recorded snapshots and validated history support these legacy previews without comparing against today's disk contents. |
| **Summary-model selection**        | Live provider-grouped model list, **Follow chat model**, or **Off**. Saved profile-wide without changing the conversation model.                                                              |
| **Explicit regeneration**          | **Generate summary / Refresh summary** regenerates one outcome with the selected model and consumes provider usage. Changing models does not regenerate old cards.                            |
| **Agent tools**                    | `activity_summary_model` reads/lists/sets the summary policy. `activity_outcomes` returns bounded outcomes without raw code and can explicitly regenerate one card.                           |

## Configuration

The bundle installs plugin row `agent-activity-intelligence`. Use DSH's plugin configuration/profile patch facilities rather than editing the installed package.

| Option              | Default | Meaning                                                                                                                                         |
| ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `summaries`         | `true`  | Enable model interpretations; requests may incur provider usage.                                                                                |
| `summaryProvider`   | omitted | Initially follow the originating session's provider. Set together with `summaryModel`.                                                          |
| `summaryModel`      | omitted | Initially follow the originating session's model. Set together with `summaryProvider`.                                                          |
| `maxCards`          | `100`   | Cards per session, from 10 to 500.                                                                                                              |
| `summaryTimeoutMs`  | `45000` | Summary cancellation deadline in milliseconds, from 1,000 to 120,000.                                                                           |
| `sensitivePatterns` | `[]`    | Additional case-insensitive path regular expressions.                                                                                           |
| `excludedPatterns`  | `[]`    | Suppress matching access alerts and exclude matching content from model/plugin previews; cannot override built-in sensitive-content exclusions. |

Summaries default to enabled and follow each originating agent's model, so provider usage can occur without selecting a separate model. The acknowledged dropdown choice takes precedence over the initial provider/model defaults and survives restarts; `summaries: false` remains an overriding disable. An unavailable explicit model never silently falls back to a larger chat model.

There is one concurrent summary request, a bounded queue, and no automatic retries for unchanged failed evidence during the same runtime. In **Settings → Summaries**, an explicit summary model's **Effort** offers Auto (the lowest supported effort), Model default, and the exact efforts advertised by that model. Auto uses the first entry of DSH's least-to-greatest capability list, including provider-specific effort IDs; models without effort controls use their provider default. The choice is persisted independently of chat; changing models clears the previous effort. Follow mode also uses the lowest supported effort, not the working agent's effort. No model or effort controls remain in the activity feed. Each path-rule list accepts up to 30 patterns of 200 characters each; invalid regular expressions do not match.

## Privacy and limits

- **AI summaries send code excerpts to your selected provider.** Inputs are bounded and redacted, not metadata-only. Choose **Off** if those excerpts must not leave your machine.
- Plugin storage includes sanitized metadata, validated narratives, and bounded, redacted whole-file snapshots captured from successful authorized edit/write results. Sensitive paths are excluded; no extra filesystem reads are made for snapshot capture.
- Secret filtering is **best-effort**, not a guarantee. Native Review is DSH's own viewer and may show unredacted source under DSH's normal access rules.
- This is an **activity feed, not a security audit or enforcement system**. Shell reads, MCP operations, nested PTC dispatches, remote agents, external processes, and background tests do not have complete semantic coverage. An empty feed is not proof that no sensitive access occurred.
- Test results describe observed commands, not exhaustive coverage or correctness. Historical sessions must be loaded/observed; the feed is not an exhaustive history scan.
- The plugin cannot approve tools, weaken permissions, or modify project files. Aggregated-feed RPC access is restricted to authenticated profile-owner callers.

Turning summaries off does not stop local evidence collection or caching. Clicking native Review does not send additional code to the summary model. Main controls are bilingual; some deterministic evidence labels and fallback narratives remain English.

See [Privacy and evidence boundaries](docs/PRIVACY.md) for redaction, retention, capture limits, and verification caveats.

## Update and uninstall

For a local update, pull the source, run `npm ci --ignore-scripts`, and use DSH's bundle installation/update facilities for the same absolute directory. Restart the existing runtime when required, then refresh its page.

Disable or uninstall the plugin through DSH's plugin management for the profile where it was installed. Runtime contributions are removed, but plugin-owned cached data may remain in DSH domain storage.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run format:check
```

Use `npm run format` to apply the repository's Prettier rules. See [Development guide](docs/DEVELOPMENT.md) for the implementation map and local reload notes.

GitHub Actions runs unit/integration tests on Linux, macOS, and Windows with Node.js 22/24, clean-package installation checks, and public-contract smoke tests against minimum/latest DSH. See [CI checks](docs/CI.md) for the exact checks, limitations, and local commands.

## License

[MIT](LICENSE). The plugin icon is original artwork. The working-state whale tail is adapted from DSH; its existing attribution is preserved in [Third-party notices](THIRD-PARTY-NOTICES.md).
