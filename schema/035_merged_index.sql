-- Merged tasks found by what they were merged into. The app's list asks this for every task
-- (the places a merged task was also seen); without an index it scanned every task each time.
CREATE INDEX IF NOT EXISTS tasks_merged_into ON tasks(merged_into) WHERE merged_into IS NOT NULL;

PRAGMA user_version = 35;
