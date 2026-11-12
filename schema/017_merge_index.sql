-- The app's task list asks, for every task, whether a merge is suggested with it (SCR-32).
-- Looked up by either side of the pair: the primary key covers task_id, this covers other_id.
CREATE INDEX IF NOT EXISTS merge_suggestions_other ON merge_suggestions(other_id);

PRAGMA user_version = 17;
