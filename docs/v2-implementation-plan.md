# V2 mockup workspace implementation

## Scope and preservation

Branch: `v2/mockup-workspace`, based on main `9005068a8b21c9c28801860887c7849eedc0f07d`.
The original checkout, v1, existing ports 15176/15178/5274, SQLite data and limited browser container remain untouched. Use this independent worktree and new test data. No main merge is authorized.

## Delivery sequence

1. Define bounded mockup DTOs, fixtures and explicit missing/invalid/legacy/hash states.
2. Read only registered intent rough/refined contract entry points through the existing safe reader. Keep parsing, byte integrity and official stage state independent; preserve every asset, mapping and AC.
3. Add optional expectedContext at the HTTP boundary, separate from visible prompt text. Compare execution context and latest turn in admission's existing immediate transaction, re-read referenced contract/assets before admission and immediately before runner invocation. Reuse the existing zero-call finish path and preserve previous cumulative costs and reservations.
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
