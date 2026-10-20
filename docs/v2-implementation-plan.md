# V2 mockup workspace implementation

## Scope and preservation

Branch: `v2/mockup-workspace`, based on main `9005068a8b21c9c28801860887c7849eedc0f07d`.
The original checkout, v1, existing ports 15176/15178/5274, SQLite data and limited browser container remain untouched. Use this independent worktree and new test data. No main merge is authorized.

## Delivery sequence

1. Define bounded mockup DTOs, fixtures and explicit missing/invalid/legacy/hash states.
2. Read only registered intent rough/refined contract entry points through the existing safe reader. Keep parsing, byte integrity and official stage state independent; preserve every asset, mapping and AC.
3. Add optional expectedContext at the HTTP boundary, separate from visible prompt text. Safely re-read and compare execution context and referenced contract/assets before admission; compare the latest turn and insert together in admission's existing immediate transaction; repeat the context/reference checks immediately before runner invocation. Reuse the existing zero-call finish path and preserve previous cumulative costs and reservations.
4. Build three-region mockup workspace: conversation and editable draft, central actual HTML/document reader, logical design-document navigation. Keep viewed round distinct from execution round and past rounds read only. No state replay claim for shared HTML.
5. Connect explicit drafts, numbered answers and fixed actions to frozen execution context. Draft text is fully visible, no auto-send after permission approval, no automatic retry after CONTEXT_STALE.
6. Verify isolated fake API, reader/auth/security, concurrent stale tabs, cost accounting, keyboard/IME/mobile/200% zoom, lint/types/tests/build and E2E.
7. Reconfirm existing model/auth/pricing and the shared USD 1000 budget (prior conservative usage USD 1.11), then perform a separate synthetic real-AI two-round verification when supported by existing authorization and environment. Record any blocker precisely; never replace real evidence with fake results.
8. Create an ordinary PR and confirm final-head CI. Do not merge main.

## Contracts

Pinned upstream: `61da68f29914d50c0f962853d04b03df9fa3af9c`; references: `poc/ui-poc/scopes/ui-poc-requirements.md`, `poc/ui-poc/tools/ui-poc/contract.md`, `poc/d-acceleration/design-document-guide.md`, rough/refined contributions.
Rough evidence → requirements → stories/formal AC → refined HTML/interaction spec/contract → integrated all-intent design document. Refined approval completes the requirements round separately from documentation update. approvedSnapshot does not prove personal approval. Schema 1 is legacy/unverified and does not change engine migration settings.

Execution context consists of space, active intent, currentStage and latest turn id/seq. Optional reference context consists of viewed intent/stage and actual contract/asset hashes plus the selected mapping; mock revision requires it. Old clients may omit context. Numbered answers and stage decisions from V2 always carry execution context. Admission rejects stale context with HTTP 409 CONTEXT_STALE, keeping drafts without retry. External editor atomicity and durable artifact versioning are outside P0 guarantees.

Preview remains signed, directory-limited and sandboxed with allow-scripts only. Owner/loopback/Origin/mode checks and hidden/audit/JSONL/symlink/traversal restrictions remain unchanged. All labels and check strings are untrusted text.

## Verification record

Initial inspection: original checkout clean main at 9b3cfca; fetched origin/main at 9005068. No app/ancestor AGENTS.md or app .agents skills found. Read sibling frontend-design skill for relevance; it is outside this repo and is not an implementation dependency. Independent worktree created at task-3/v2-workspace. Existing API health: 15176 fake/not-ready, 15178 fake/ready, dedicated 15180 fake/ready. Existing 5274 health path returned 502 before changes. No paid model calls during setup.

Reader/admission checkpoint: 30 targeted tests, 216 assertions passed; typecheck passed. Added strict optional control metadata, registered-intent contract-only entry points, all mapping/AC retention, limits and independent parsing/hash/stage states. CAS uses the same response cursor used for option parsing. Pre-CLI revalidation reuses zeroCall; regression covers cumulative 5/stale/7 and preservation of an earlier unknown reservation. Legacy clients keep existing prompt behavior; context-aware typed submissions retain exact visible text. Mockup revision purpose requires a reference context.

UI checkpoint: central real HTML preview and wide document reading share one pane, preserving outer mock selection and unsent draft. Left progress/actions are collapsible. Right navigation follows upstream logical layers, excludes CSS/internal logs from the primary list and retains safe ZIP downloads. Shared-HTML states explicitly require interaction inside the mock; selecting a state makes no replay claim. Fake fixture now provisions two immutable synthetic rounds, separate from real approval evidence. Added explicit E2E port overrides for isolated local validation (19340/19341).

First broad check: lint/typecheck/build passed; 149 tests / 561 assertions passed before the additional mock-reference API test (that targeted API suite also passed). Initial E2E sandbox wait-listen failed without executing browser actions; rerun with the allowed independent listeners is in progress.

Regression checkpoint: lint / strict types / 152 tests (574 assertions) / build / all 12 FakeRunner browser E2E passed. V2 coverage includes shared and separate HTML, every AC, unsent visible drafts, legacy indication, document round-trip, stale second tab after first completion, Japanese IME, keyboard navigation, mobile region switching and 200% zoom. Actual screenshots inspected. Mid-read contract replacement and aggregate 8 MiB read cap are tested. Existing owner/token/preview/ZIP/permission checks remain active.

Real-AI setup (not completion): independent API at 127.0.0.1:19350, new external `/tmp/aidlc-v2-live-20261020`, synthetic project only. Official merged source fetch/install and dedicated hash preflight passed with modelUsed=false. Existing account suffix3462 confirmed. Re-downloaded official Tokyo tariff JSON version20261012084008 / SHA256 da0a9d6a7e0424ff41d6cd8ea731a6e7112fb3a7c5b2f4c0d39b36b42826c701; rates remain 3.30/16.50/0.33/6.60 USD per1M input/output/cache-read/1h-cache-write. Pin sonnet and background haiku aliases to the explicitly priced Sonnet4.6 for this verification via inherited environment; no credentials, IAM or permission changes. Proposed verification limits: CLI3 USD/turn, project30 USD, at most40 explicit sends, external conservative reservation60 USD against prior1.11 USD usage and1000 USD authorization. CLI caps remain soft, not a hard AWS cutoff. Real two-round outcome remains pending.

Legacy clarification: a schema1 contract with safely readable, matching bytes can produce an explicitly labelled legacy/unverified discussion draft. This is not stage approval or evidence-checker success; unknown/invalid schema and mismatched assets still cannot create a mock revision. The reference hash binds the legacy bytes exactly. No engine migration setting is changed. The browser test now positively verifies the legacy warning in the generated text, then clears it explicitly before testing refined. Also recheck execution context after reference reads, enforce the20,000-character bound on the full visible body and provide model-free contract refresh.

Request-body race checkpoint: API suite16 tests /154 assertions passed, including a streaming request body held open while a second turn completes. The option is parsed from the response cursor obtained after body completion, and the same cursor is checked at admission. README now includes separate fake-only19360/19361 startup with a new temporary data directory. Existing checkout/services are unchanged. PR18 is ordinary/open; no merge configured. The ca150dd push CI succeeded; PR-event CI is still running at this checkpoint.
