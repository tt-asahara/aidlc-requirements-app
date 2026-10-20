CREATE TABLE users (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
 workspace_dir TEXT NOT NULL, aidlc_sha TEXT NOT NULL, claude_session_id TEXT NOT NULL,
 claude_session_started INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('provisioning','ready','error')), error_message TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE turns (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), seq INTEGER NOT NULL,
 claude_session_id TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('typed','option','action')), action TEXT,
 prompt_text TEXT NOT NULL, submitted_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','budget_exceeded','timed_out','cancelled')),
 result_text TEXT, session_cost_usd REAL, turn_cost_usd REAL,
 reserved_cost_usd REAL NOT NULL DEFAULT 0 CHECK(reserved_cost_usd >= 0),
 cost_reconciled INTEGER NOT NULL DEFAULT 0, num_turns INTEGER, error_message TEXT,
 log_path TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
 UNIQUE(project_id, seq)
);
CREATE UNIQUE INDEX one_active_turn ON turns(project_id) WHERE status IN ('queued','running');
CREATE TABLE permission_requests (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), turn_id TEXT NOT NULL REFERENCES turns(id),
 tool_name TEXT NOT NULL, tool_input TEXT NOT NULL, rule TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','revoked')),
 decided_by TEXT REFERENCES users(id), decided_at TEXT, created_at TEXT NOT NULL
);
