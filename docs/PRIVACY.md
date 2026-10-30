# Privacy and evidence boundaries

[English README](../README.md) · [简体中文说明](../README.zh-CN.md)

## What is stored locally

The persisted projection/cache contains filenames, file IDs, operation metadata, verification labels, event references, validated narratives, and **bounded, redacted whole-file versions for recorded-content previews**.

Whole-file versions are captured only from successful canonical edit/write results already authorized by DSH, not through extra filesystem reads. Sensitive paths are excluded. Capture limits are:

| Limit                            | Bound      |
| -------------------------------- | ---------- |
| Characters per before/after side | 200,000    |
| Lines per before/after side      | 5,000      |
| Stored snapshot records          | 100        |
| Total snapshot characters        | 10 million |

These local snapshots are not automatically sent whole to the model. Raw assistant messages, commands, and complete shell output are not duplicated into plugin storage. Workspace comparisons are process-local DSH evidence; the plugin caches their sanitized metadata rather than their contents.

Aggregation covers sessions observed by the plugin, with up to 200 cached session snapshots. By default, up to 100 cards per session and 500 summary records are retained. Unopened historical sessions may have no feed until DSH loads/replays them. Cached child cards are labeled historical. Disable/uninstall removes runtime contributions but may leave plugin-owned data in DSH domain storage.

## What the summary provider receives

Summary requests are **not metadata-only**. They include bounded, redacted excerpts of non-sensitive changes, the nearest available user request, and a clearly unverified agent report. Excerpts are held in a bounded in-memory cache and sent to the selected summary provider.

| Limit                               | Bound        |
| ----------------------------------- | ------------ |
| Files in model context              | 12           |
| Excerpt characters per file         | About 2,000  |
| Serialized model-context characters | 20,000 total |
| Event tail for task/report recovery | 1,500        |

Choose **Off** in the summary-model dropdown, or set `summaries: false`, if code excerpts must not leave the machine. This disables model requests, not local evidence collection or caching. Summaries default to enabled and follow the originating agent's model unless overridden, so provider usage can occur without selecting a separate model.

## Sensitive content and redaction

Content from `.env` files (including examples), SSH/cloud credential directories, private keys, and other sensitive paths is excluded from model input and plugin-owned previews. Template/example `.env` files do not trigger access-alert cards, but their content is still excluded.

Common credential assignments, provider tokens, PEM blocks, authenticated URLs, and opaque high-entropy values are redacted. **Secret detection is best-effort, not a guarantee**: arbitrary source files can contain unrecognized secrets.

Custom `sensitivePatterns` add path rules. `excludedPatterns` suppress matching access alerts and exclude matching content from model/browser evidence; they cannot opt built-in sensitive paths back into content capture. Both are case-insensitive regular-expression lists, with at most 30 patterns of 200 characters each. Invalid regular expressions do not match.

## Native Review versus plugin previews

New changed-file clicks require an exact same-session/turn/path match and open DSH's existing **Review · turn N**. Missing native Review evidence produces an explicit error, not a substitute custom diff tab.

**Native Review is not a plugin-generated sanitized preview.** It follows DSH's normal file-access and display behavior, including the file picker and potentially unredacted source. The plugin does not inspect unrelated picker files or substitute a viewer based on their contents. Clicking Review does not send additional code to the summary model. Native editor actions and opening current files are deliberate user actions governed by DSH's path and desktop checks.

Previously opened custom diff tabs remain readable for compatibility. Their snapshots remain redacted. Historical full context can sometimes be reconstructed from complete logged reads/writes plus exact successful edits, with newline-normalization and concurrency caveats. Incomplete edit blocks and workspace hunks are labeled partial; a write can show an after-file without claiming an unknown before-file. Missing/disposed history is unavailable rather than compared against current disk contents.

Legacy fallback highlighting runs locally after redaction and returns text tokens, never HTML. Old/new streams are highlighted separately with light/dark palettes. Limits are 5,000 rows, 200,000 characters, 50,000 tokens, and 10,000 characters per source line, with a per-line tokenizer deadline. Unsupported languages or grammar failures remain readable as plain text.

## Summary trust boundary

The summarizer has no tools. Task text, agent reports, filenames, comments, and code are untrusted evidence, not instructions. Accepted output is bounded, filtered, and tied to supplied change IDs. Both headline and description must be useful; insufficient context remains explicit. Counts and execution verification never come from the model.

These constraints reduce but cannot eliminate hallucinations. An AI source badge is not proof that a feature works. Model failures or rejected output leave factual evidence available.

There is one active summary request and a queue capped at 64. The default cancellation deadline is 45 seconds. Unchanged failed evidence is not automatically retried during the same runtime; this is not a permanent no-retry guarantee across restarts. Loaded-session backfill targets only the newest completed outcome, not the entire history. Model changes cancel old work where supported and affect future summaries. Explicit per-card regeneration consumes provider usage.

## What observed verification means

Supported foreground commands use numeric Node TAP/spec, pytest, Vitest, and Jest summaries. Successful exit alone never supplies a pass count. Selected tests are partial when their scope cannot be mapped to every changed file. Later modifications stale earlier verification.

Composite shell commands, pipes, redirects, watch-mode tests, background jobs, unrecognized runners, and truncated output cannot establish successful foreground verification. DSH's foreground renderer emits an exit-code marker only for nonzero exits; a numeric supported summary without failure, stop, timeout, background, or truncation markers is treated as its successful completion case.

Observed results describe commands that ran. They do not guarantee exhaustive coverage or correctness. Recorded workspace changes under concurrent agents have uncertain attribution. Net-zero and formatter-only edits can still produce direct-tool modification cards.

## Coverage and permissions

This is an activity feed, **not an OS security audit or enforcement system**. Direct DSH file tools and recognized tests are covered. Shell reads such as `cat .env`, MCP operations, nested PTC dispatches, remote agents, terminal sessions, and external processes do not have complete semantic coverage. Never interpret an empty feed as proof that no sensitive access occurred.

Only authenticated profile-owner RPC callers can read the aggregated feed. The plugin cannot approve tools, weaken permissions, or change project files. Installation affects the current DSH profile, not only one session.
