# Feature and configuration reference

[README](../README.md)

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

| Feature                            | Behavior                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Recognized test summaries**      | Numeric Node TAP/spec, pytest, Vitest, and Jest summaries from supported foreground commands. A zero exit code alone never supplies a pass count.                                                           |
| **Partial and stale verification** | Selected tests are labeled partial when their scope cannot cover all changed files. Later modifications stale earlier verification.                                                                         |
| **Separate checks**                | `npm run check`/`lint`/`typecheck`/`format:check`, `prettier --check`, `tsc --noEmit`, `eslint`, and `node --check` are recorded in a collapsed Checks section and never count as tests or certify changes. |
| **Piped runs**                     | Test/check commands at the start of a pipeline are recorded for history; the pipeline exit code is not treated as verification.                                                                             |
| **Delegated subtasks**             | Owned child cards are grouped in a collapsed Subtasks section. Exact assignment evidence wins; timestamp-based placement is explicitly inferred, and child Reviews remain clickable.                        |
| **Sensitive-file alerts**          | Direct `read` / `read_image` access to recognized `.env` variants, SSH configuration/keys, credentials, and common secret-file extensions. Template/example `.env` files are excluded from access alerts.   |
| **Distinct access outcomes**       | Successful access, denied attempts, and failed attempts are shown separately.                                                                                                                               |
| **Custom path rules**              | Add case-insensitive sensitive-path regular expressions and exclusions through plugin configuration.                                                                                                        |

### Review and summary controls

| Feature                      | Behavior                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Native Review navigation** | Opens the exact same-session/turn/path **Review · turn N** used by DSH's **Edited N files** card, selecting the clicked file.                                              |
| **Native editor experience** | Keeps syntax colors, split/inline layout, file picker, wrapping, and editor menu. Missing native Review evidence produces an explicit error, not a substitute custom diff. |
| **No custom diff viewer**    | The plugin does not register or open a substitute diff tab. Changed-file clicks require native Review coordinates; otherwise they show an explicit error.                  |
| **Summary-model selection**  | Live provider-grouped model list, **Follow chat model**, or **Off**. Saved profile-wide without changing the conversation model.                                           |
| **Explicit regeneration**    | **Generate summary / Refresh summary** regenerates one outcome with the selected model and consumes provider usage. Changing models does not regenerate old cards.         |
| **Agent tools**              | `activity_summary_model` reads/lists/sets the summary policy. `activity_outcomes` returns bounded outcomes without raw code and can explicitly regenerate one card.        |

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

Subagent activities can also use DSH's native task label and a bounded, redacted assistant-result preview. These are labeled **Agent report (unverified)**, not proof of implemented changes or passing tests. Research-only results do not require an extra summary-model request; reports also provide a fallback while an edit-based summary is pending or unavailable.

## Update and uninstall

For a local update, pull the source, run `npm ci --ignore-scripts`, and use DSH's bundle installation/update facilities for the same absolute directory. Restart the existing runtime when required, then refresh its page.

Disable or uninstall the plugin through DSH's plugin management for the profile where it was installed. Runtime contributions are removed, but plugin-owned cached data may remain in DSH domain storage.
