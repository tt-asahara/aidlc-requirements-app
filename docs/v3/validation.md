# V3 validation — 2026-10-23

Validation uses isolated synthetic projects and private application data. The user's open workbench is retained. No automated model prompts, login-token access, AWS changes, or public deployment.

| Scope | Result | Evidence / practical limit |
|---|---|---|
| Existing V2 | 195 tests, 875 assertions, 22 browser E2E; lint, typecheck and build pass | Real model is not part of regression. Web bundle retains the existing size advisory. |
| V3 core | 11 Node tests pass | Actual HTTP service with 20 authenticated clients, project memberships, one editor, renewal/expiry/epoch, CAS, full-manifest validation, comments and immutable restore. Local file/harness isolation and interrupted recovery. |
| Official Claude TUI | Pass | User-installed 2.1.309. Actual interactive folder-confirmation screen at 53 and 89 columns, no input/permission acceptance/model prompts. xterm/PTY initial geometry agrees; own PID exits after stop. |
| Terminal rendering | Pass | Explicit synthetic PTY fixture covers Japanese/full-width characters, split UTF-8 bytes, ANSI cursor/color, alternate screen, SIGWINCH, independent right resize and saved width after restart. This fixture is not model output. |
| Native preview / annotation | Pass | Actual dynamic HTML interaction, native PNG capture, image hash/file reference and full editable draft, clipboard text plus PNG confirmed after awaited Electron45 write. Source changes reject stale copy without losing text. |
| Preview boundary | Pass | No Node/preload/terminal bridge, file URL or external network. Selected-directory asset allowlist, different source storage origin, another HTML cannot silently replace the captured source. Narrow region navigation works. |
| Two Electron clients | Pass | Same immutable head, lease conflict, revoke, stale publication rejected, old local output retained outside current shared snapshot, publish/comment/history restore. |
| Harness UI | Pass | Import/diff/explicit security check/apply/settings preservation/restart/rollback. Native folder-picker return is stubbed in the test-only entry; production IPC cannot inject a folder path. |
| Source fetch | Pass | Fixed upstream Git source resolves `61da68f29914d50c0f962853d04b03df9fa3af9c`; exact fetch SHA verified, no fetched scripts executed. Fetch and prepared distribution/apply stay separate. |
| Actual local prepared harness | Pass | 353 files / 172 security-sensitive changes, content manifest `be5bd8c6fb6f41464dad343f4d77077a59ca417d4e119cd8c22094d77bf7762e`. Applied only to empty synthetic project, bundled Bun runs read-only/offline `aidlc --version`: `aidlc 2.11.0 (runtime 2.11.0)`, then rollback. Empty isolated HOME, no official CLI/model. Prepared local bytes are not falsely attributed to the fetched source SHA. |
| Workflow projection | Pass | Existing V2 reader reused; execution round/stage separated from viewed round, every AC/mapping retained, same HTML multiple states do not imply replay, legacy schema distinct, active-space/active-intent preserved in shared manifest. |
| macOS arm64 package | Pass | Electron45 + native PTY + Bun1.3.14. Local ad-hoc signature verified, native app starts, official CLI version, real HTML/capture, same project restored after restart. No external Node/Python/Bun runtime. |

## Reproducible commands

```sh
bun run lint
bun run typecheck
bun test
bun run build
bun run e2e
bun run v3:test
bun run v3:build
node scripts/v3/desktop-integration.mjs
node scripts/v3/terminal-layout.mjs
node scripts/v3/terminal-ansi.mjs
node scripts/v3/two-clients.mjs
node scripts/v3/harness-ui.mjs
node scripts/v3/workflow-ui.mjs
node scripts/v3/package-mac.mjs
node scripts/v3/packaged-smoke.mjs
```

The explicit optional `official-harness-check.mjs <local prepared distribution>` checks only synthetic installation/read-only version/rollback. It is not run by fetch or normal startup.

## Remaining production work / non-claims

- Production OIDC/TLS, membership identity and hosted adapter endpoint are unconfigured. Local invitation auth is a verification adapter, not a 20-person hosted rollout.
- Developer ID signing, notarization, Windows/Linux distribution and public release review are not done. Package is a local macOS arm64 build; third-party notices are included.
- Published release list/download/digest+tag-commit pin/diff/security confirmation/apply/rollback is implemented and verified through actual Electron UI. Only a preview release is currently published and it requires explicit selection. A fetched develop commit is not automatically built or executed. Root `.mcp.json` and external/cloud MCP settings are deliberately outside that import. Git is needed for source fetching.
- The app neither reads Claude login tokens nor verifies subscription/billing identity. The user operates official CLI auth. No automated Team model/image-input or long AI-DLC workflow verification was performed; prior V2 model runs are not V3 evidence.
- Existing user-controlled/external editors cannot be made fully atomic with capture or publication. Stable reads/hashes reject observed races; server publication validates the complete frozen manifest and atomically switches its reference.
- Agent-triggered V3 model calls and Bedrock usage: 0. Human CLI usage is separate, and no cost is invented for it. Existing V2 ledger/unknown reservation is untouched.
- The PR workflow runs V3 service/data checks and renderer/reader build alongside existing regression. Native macOS UI/CLI acceptance is separate local evidence; no main merge is part of this work.


## Additional acceptance and machine-readable records

- Actual packaged `Claude Codeを起動` produces the interactive folder-confirmation TUI, not just version text. No answer, login, permission acceptance or model prompt was inserted.
- Starting without a project opens an explicit create/select dialog. The agent does not silently choose a directory.
- Settings release flow verified with official published preview archive SHA256 `ce7f56ff3d6adc8f8b80ff834c3bf95faef188b8e78bc7be38e78e49aa0b23e2`, resolved tag commit `6a378b53c0a4fe0641ed7d8de8dfff94264d5b6a`, prepared content hash `e3285796ac083a86354c51aaf1627a231d28e51fa077bc4b468bbb4c634eba98`. Download alone changes no project; stale review-plan ID rejects apply; explicit security confirmation, apply and rollback pass. Fetched code execution and new credentials: 0.
- Test records are emitted under `../evidence/v3/`: `twenty-clients-current.json`, `two-clients-current.json`, `desktop-tui-current.json`, `release-ui-current.json`, `packaged-acceptance.json`, plus timestamped historical JSON. These contain synthetic results and no invites/session tokens. Repeatable record creation is in `scripts/v3/record.mjs`.
- Public GitHub API returned a verified rate-limit 403; the client uses the same public repository's feed/checksum plus anonymous Git ref resolution, without tokens or account changes. SHA/pin verification remains mandatory.

- Disconnect acceptance now also stops the synthetic hosting process, verifies the other client's running official CLI is not falsely marked stopped, quarantines late local output, and releases only the disconnecting session's lease. Service restart preserves the head while invalidating old memory-only sessions/lease epochs.
- Scheme/sandbox/profile initialization is synchronous before ESM loading; packaged cold/restart acceptance catches the Electron ready-order race.


Latest executable acceptance is `ae0ce69004e9`: the packaged startup-button/create-project path reaches the real official Claude TUI, resize changes 53→89 columns, and stop confirms the owned PID has disappeared. `packaged-tui-current.json` stores this actual runtime build commit and exact application path; `packaged-acceptance.json` matches the same revision and verifies restart. Superseded `c230214` packages failed the pre-ready initialization check and are not accepted. Test-only evidence refinements can have a later repository commit without changing this executable's source.


## Independent review corrections

- Management JSON uses same-directory temporary files, fsync and rename. A truncated current receipt no longer prevents artifact projection; validated backup journals remain available for explicit recovery. Staged bytes are removed only when journal path/hash ownership matches. Unknown stage contents and modified installed files remain untouched.
- Publication rejects file/directory prefix conflicts after normalization/case folding before updating the shared head.
- Comment drafts retain project and version through project switches and head updates. An old-version comment needs explicit confirmation and cannot be silently attached to another project/head. Electron UI regression covers the switch/update/send path.
