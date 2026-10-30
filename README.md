# Agent Activity Intelligence

A native DSH right-sidebar feed for **what changed**, **observed verification**, and **sensitive-file access**. Routine reads and web searches stay quiet.

## Open it

After installation, refresh the existing DSH page. Open **What changed** from the conversation header or the right-sidebar guide. The panel includes the current session and observed local subagents; independent session forks are not grouped as subagents. Expand **Changes / 变更** and click a file to open a **right-sidebar Review tab**, not a modal. This opens the exact built-in **Review · turn N** used by DSH's **Edited N files** card, selecting the clicked file and retaining native syntax colors, split/inline layout, file picker, wrapping, and editor menu. If that recorded native Review is unavailable, an explicit error is shown; new clicks never substitute a custom **filename · Diff** tab. Previously opened custom tabs remain readable only for backwards compatibility. Working cards show a whale tail, **Agent is still working**, and animated dots. **Debug details / 调试详情** remains off by default; enabling it reveals the optional collapsed technical trace. The model's grounding evidence is available regardless of this display toggle.

## Behavior

- Successful direct `read`/`read_image` calls against `.env` variants, SSH configuration/key files, credentials, and common secret-file extensions produce sensitive-access cards. Denied and failed attempts are distinct. Template/example `.env` files are excluded.
- Successful direct `edit`/`write` calls group into an evolving card per agent turn. Failed modifications generate attention cards rather than change claims.
- Recorded DSH workspace comparisons add shell-originated changes where available, without pretending they prove which concurrent agent caused them. Comparisons are process-local DSH evidence; the plugin caches their sanitized metadata, not their contents.
- Supported foreground test commands use numeric Node TAP/spec, pytest, Vitest, and Jest summaries. Successful exit alone never supplies a pass count. Selected tests are labeled partial when their scope cannot be mapped to every changed file. Later modifications stale earlier verification.
- Outcome interpretation runs once at a turn checkpoint, not after each edit. The model receives bounded, redacted before/after edits or recorded workspace hunks, the nearest available user request, and a clearly unverified agent report. It describes **what behavior changed and why it matters**, rather than listing file operations. Both the headline and description must be useful, and supporting change IDs must refer to actual supplied changes. Insufficient context is shown honestly; a title-only result no longer replaces a missing description. AI summaries have a subtle source badge, not repeated `Inferred:` prefixes. Counts and verification remain deterministic evidence.
- Model failure, rejected output, or missing model selection leaves factual cards available. No model is needed for sensitive-access detection.

## Privacy and trust boundary

The persisted projection/cache contains filenames, file IDs, operation metadata, verification labels, event references, validated narrative, and **bounded, redacted whole-file versions for the diff viewer**. Whole-file versions are captured only from successful canonical edit/write results already authorized by DSH—not by extra filesystem reads. Sensitive paths are excluded. Capture limits: 200,000 characters and 5,000 lines per side, 100 records and 10 million characters total. These browser snapshots remain local and are not automatically sent whole to the model. Fallback syntax highlighting runs locally after redaction and returns text tokens, never HTML; old/new streams are highlighted separately with light/dark palettes. Highlighting is bounded to 5,000 rows, 200,000 characters, 50,000 tokens, and 10,000 characters per source line, with a per-line tokenizer time limit. Unsupported languages or grammar failures stay readable as plain text.

Unlike the initial metadata-only version, **summary requests now include redacted excerpts of non-sensitive code changes and bounded task/report text**. Excerpts are held in a bounded in-memory cache and sent to your selected summary provider. Raw assistant messages, commands, and complete shell output are not duplicated into plugin storage. Disable model summaries if code excerpts must not leave the machine.

Content for `.env` files (including examples), SSH/cloud credential directories, private keys, and other sensitive paths is excluded from model input and plugin-generated previews. Common credential assignments, provider tokens, PEM blocks, authenticated URLs, and opaque high-entropy values are redacted. Secret detection is best-effort, not a guarantee; do not assume an arbitrary source file cannot contain an unrecognized secret. Limits: at most 12 files, about 2,000 characters per file, 20,000 serialized model-context characters total, and a bounded 1,500-event tail for task/report recovery.

Native Review navigation requires an exact same-session/turn/path match. It is the existing DSH viewer—not a plugin-generated sanitized preview—and follows DSH's normal file-access and display behavior, including its file picker and potentially unredacted source. The plugin does not inspect unrelated picker files or substitute another viewer based on their contents. Clicking Review does not send additional code to the summary model. Summary-provider excerpts and plugin-owned previews remain redacted. Native editor actions and opening the current file are deliberate user actions governed by DSH's native path and desktop checks.

The summarizer has no tools. All task text, agent reports, filenames, comments, and code are treated as untrusted evidence rather than instructions. Accepted text is bounded, filtered, and tied to supplied change IDs; execution verification is not supplied by the model. This reduces but cannot eliminate hallucinations. The AI source badge is not proof that a feature works.

Only authenticated profile-owner RPC callers can read the aggregated feed. The plugin cannot approve tools, weaken permissions, or change project files. Installation affects the current DSH profile, not just one session.

## Limits

This is an activity feed, **not an OS security audit or enforcement system**. Direct DSH file tools and recognized test commands are covered. Shell-based reads (for example `cat .env`), MCP operations, nested PTC dispatches, remote agents, terminal sessions, and external processes do not have complete semantic coverage in this version. Do not interpret an empty feed as proof that no sensitive access occurred.

Composite shell commands, pipes, redirects, watch-mode tests, background jobs, unrecognized runners, and truncated output cannot establish a successful foreground verification. Real DSH foreground rendering emits an exit-code marker only for nonzero exits; a numeric supported summary with no failure, stop, timeout, background, or truncation markers is treated as the renderer's successful completion case.

Observed test results describe commands that ran; they do not guarantee exhaustive coverage or correctness. Workspace changes under concurrent agents have uncertain attribution. Net-zero edits and formatter-only changes can still produce a direct-tool modification card. Changed-file links use workspace-relative labels to distinguish duplicate basenames. New direct edit/write operations capture complete before/after file versions for a full-file unified viewer. Historical full line context can sometimes be reconstructed from complete logged reads/writes plus exact successful edits, with normalized-newline and concurrent-change caveats. Logged edit blocks and native workspace hunks are clearly labeled partial when complete versions are missing; writes may show a whole after-file without claiming an unknown before-file. Missing/disposed history is explicitly unavailable rather than comparing against current disk contents.

Aggregation covers sessions observed by this plugin (up to 200 cached session snapshots), not an exhaustive historical scan. Up to 100 cards per session and 500 summary records are retained by default. Unopened historical sessions may not have a feed until DSH loads/replays them. Cached child cards are labeled historical. Disabling/uninstalling removes runtime contributions; plugin-owned cached metadata may remain in DSH domain storage.

## Configuration

The bundle installs row `agent-activity-intelligence`. Use DSH's plugin configuration/profile patch facilities rather than modifying the installed package.

| Option              | Default | Meaning                                                        |
| ------------------- | ------- | -------------------------------------------------------------- |
| `summaries`         | `true`  | Enable batched model interpretations; may incur provider usage |
| `summaryProvider`   | omitted | Use the originating session's model provider                   |
| `summaryModel`      | omitted | Use the originating session's model                            |
| `maxCards`          | `100`   | Projection card limit, 10–500                                  |
| `summaryTimeoutMs`  | `45000` | Summary request cancellation deadline                          |
| `sensitivePatterns` | `[]`    | Additional case-insensitive path regular expressions           |
| `excludedPatterns`  | `[]`    | Path exclusions, evaluated before sensitive rules              |

### Summary-model dropdown

Open **What changed / 变更与关注** and use **Summary model / 摘要模型** at the top. The dropdown lists models from the live configured providers, grouped by provider. Choose a small model for low-cost interpretations, **Follow chat model** to explicitly use each working agent's model (potentially expensive), or **Off** for factual cards only.

The acknowledged choice is saved profile-wide across restarts, without changing any chat's model. UI saves take precedence over the `summaryProvider`/`summaryModel` initial defaults. An unavailable explicit model never silently falls back to a larger chat model. Changes cancel queued/active old-model work where supported and apply to future summaries; existing cards are not regenerated. The plugin prefers a supported none/minimal/low reasoning effort and never inherits the working agent's max effort. When none of those efforts is offered, the selected model uses its adapter default.

Agents can use `activity_summary_model` with `action: get`, `list`, or `set` to perform the same operations. A model selection requires `mode: model` plus provider/model IDs from `list`; `mode: follow` and `mode: off` require neither. The tool performs no inference requests itself.

Set provider and model together when overriding the initial summary route. There is one concurrent summary request, a bounded queue, and no automatic retries for unchanged failed evidence. Summary records are keyed by evidence fingerprint and summarizer version. The behavior-summary upgrade invalidates the old metadata-only narratives and backfills only the newest completed outcome per loaded session, not the entire history. Use a card's **Generate summary / Refresh summary** button to explicitly regenerate an older outcome with the selected model (consumes provider usage); this avoids expensive bulk history reprocessing. Agents can read bounded summaries using `activity_outcomes` (current session by default), optionally waiting for pending summaries or passing `regenerateCardId` for the same explicit operation. This returns no raw code.

## Development

```sh
npm install --ignore-scripts
npm test
npm run check
npm run format:check
```

Run `npm run format` to apply Prettier across source, tests, documentation, and
configuration files. Formatting uses single quotes in JavaScript and Prettier's
other defaults. Dependencies, caches, build output, and the npm-managed lockfile
are excluded.

Install the absolute workspace directory with DSH `plugin_manager` → `install_bundle`. Do not start a second Web server. Updated installed JavaScript generations may require restarting the existing DSH runtime; refreshing alone does not reload Host modules.

## Implementation map

- [engine.js](engine.js): pure replayable evidence projection and claim filtering.
- [workspace.js](workspace.js): conservative recorded-comparison enrichment.
- [coordinator.js](coordinator.js): bounded summary queue, narrative cache, and event-driven watches.
- [change-context.js](change-context.js): redacted model excerpts and browser evidence.
- [recorded-files.js](recorded-files.js): bounded whole-file capture from successful canonical tool results.
- [full-file-context.js](full-file-context.js): validated historical line reconstruction, without disk reads.
- [unified-diff.js](unified-diff.js): bounded line comparison with unchanged context retained.
- [index.js](index.js): Host registration, domain storage, owner-only RPC.
- [client.js](client.js): native Review navigation, recorded-content sidebar fallback, model selection, and optional debug details.

The plugin icon is original artwork. Working cards use a wiggling whale-tail outline adapted from the MIT-licensed DSH chat indicator, with animated dots and reduced-motion support; see [third-party notices](THIRD-PARTY-NOTICES.md). No duplicate React runtime is included.
