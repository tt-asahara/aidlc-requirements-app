# Local inventory and bounded content reads

Local browsing must not depend on the total bytes or file count of a publishable shared snapshot. The metadata inventory reads no file bodies, returns at most 200 items per page, visits at most 800 directory entries per request, bounds traversal depth and cached pages, and exposes incomplete/cancelled/changed enumeration explicitly. Symlinks, hardlinks, hidden/private paths remain excluded with visible exclusion counts. Files above the content budget remain listable.

Content selection uses a separate bounded safe reader with actual-byte hash and private-content validation. Preview and annotation will bind the selected HTML, the resources actually served inside its isolated directory, and associated contract bytes/presence; unrelated project files do not define the scene version. New or changed resources invalidate a captured proof. Shared publication continues using the unchanged complete-manifest validation (20MiB total, 2MiB per file, 2000 files, lease/version fencing and server validation).

Implementation checkpoints: (1) bounded metadata/lazy-read primitives and unit regressions; (2) resource/contract scene proofs; (3) Electron pagination, lazy preview and capture/copy integration; (4) isolated packaged regression and performance evidence. The user's running app and project files are not updated or moved.
