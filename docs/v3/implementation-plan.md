# V3 local Team workbench

Base `3b4bb10`, branch `v3/local-team-workbench`, independent checkout. V2 and infra remain unchanged. No AWS apply/IAM changes/Bedrock/prompt execution/new persistent credentials.

## Architecture

- Electron trusted renderer: xterm terminal left, existing mock/image annotation concept center, artifacts right. Node disabled, context isolation and sandbox enabled; narrow IPC validates top-level sender/frame URL. Untrusted preview has separate sandboxed WebContents/session, no preload, no terminal/file bridge, offline protocol allowlist/CSP.
- Official user-installed Claude CLI runs directly in dedicated Python PTY worker; argv arrays, no shell evaluation. User HOME/login stays official CLI-owned, no OAuth extraction/proxy. Strip inherited API/Bedrock provider selectors. User explicitly starts CLI, types and approves. Terminal escape output is never an approval signal.
- Local collaboration service: real random one-use invitation capabilities, transient session tokens held in memory, project memberships, SQLite atomic immutable full manifests with version CAS and expiring lease epochs. Loopback-only verification adapter; hosted OIDC/TLS configuration remains pending. No name-only authentication or production claims.
- Edit directory per lease, shared snapshot cache per immutable version. Lost lease/disconnect never publishes automatically; retain old output in recovery. Server validates all paths/bytes/hashes then switches head atomically. No secrets/.env/.ssh/.aws/.claude sessions shared.
- Local file reader: debounce plus repeated stable full hashes, not event=>completion. Annotation draft freezes file/image/version/hash; explicit user delivery to CLI, no Enter/model submission. Reject stale reference and preserve draft.
- Harness fetch source/commit separately from apply. No downloaded scripts auto-run. Import reviewed prepared distribution, classify hooks/MCP/permissions separately, per-file backup/hash/rollback, refuse changes while PTY running. No wholesale HOME/.claude replacement.

## Delivery milestones

1. Plan and isolated checkout.
2. Shared manifest/auth/lease/CAS/history service, two/20 client tests.
3. Safe local workspace/harness/watch adapters and security tests.
4. Electron + dedicated PTY + preview/annotation/settings and actual app startup.
5. Real CLI version/interactive start without prompts or permission approval; real file updates, annotation draft, two-client UI flow and V2 regression.

No fake login/CLI/model success. Packaging/notarization and production identity/host endpoint must be stated separately from local runtime acceptance.
