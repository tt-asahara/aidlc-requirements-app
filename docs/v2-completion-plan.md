# Visual workspace completion

Acceptance criteria:

- Capture the current sandboxed mock DOM after interaction, including form values and scrolling, then render it with JavaScript disabled and no network. Keep the preview sandbox and signed directory boundary. Bind source hash, context, viewport and image hash. Unsupported canvas/media/shadow documents fail explicitly. The user reviews the actual PNG before explicit submission.
- Provide an editable, visible change-impact draft naming requirements, formal AC, mock contracts and integrated documents. Separate proposed edits from formal rework, approval and document generation. Preserve existing source/history; never imply automatic approval or synchronization.
- Offer central focus and independently collapsible chat/artifact panes, retaining drafts and preview state. Group originals, requirements and integrated documents; clearly identify permission and next actions. Keep the offline demo honest and functional.
- Verify security and stale-context paths, principal browser operations, types, build and CI on the published PR head. Keep main unmerged. Use a minimal synthetic live model check only within existing aggregate guards.

Dynamic capture is a DOM projection, not direct access to opaque iframe pixels. The capture bridge reads its own document and returns untrusted bounded data. Server rendering remains inert; no arbitrary URLs or local files are fetched. No new iframe privileges are added.
