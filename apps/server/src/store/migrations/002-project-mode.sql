ALTER TABLE projects ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'unknown' CHECK(execution_mode IN ('unknown','fake','claude'));
ALTER TABLE projects ADD COLUMN fake_scenario TEXT CHECK(fake_scenario IS NULL OR fake_scenario='requirements');
