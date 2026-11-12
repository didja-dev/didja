-- ScrolledAway shared schema, version 10: a reminder for checklists left unfinished.
-- Each top-level item is nudged about at most once.

ALTER TABLE tasks ADD COLUMN nudged_at TEXT;

PRAGMA user_version = 10;
