-- ScrolledAway shared schema, version 3: checklists are grouped under a parent task.
-- A parent ("is_group") stands for the whole checklist Claude gave; its steps point
-- at it through parent_id. The engine keeps the two in step: a parent is done when
-- all its steps are, and ticking a parent ticks its steps.

ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE tasks ADD COLUMN is_group INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN done_at TEXT;
CREATE INDEX IF NOT EXISTS tasks_parent ON tasks(parent_id);

PRAGMA user_version = 3;
