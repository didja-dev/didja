-- ScrolledAway shared schema, version 8: "looks done — confirm?".
-- For tasks with nothing exact to match, the on-device model may judge from a
-- later screen that the task looks done. That is only ever a suggestion: the
-- task stays open until you confirm it.

ALTER TABLE tasks ADD COLUMN suggestion TEXT;     -- where it looked done, written by the engine (never screen text)
ALTER TABLE tasks ADD COLUMN suggested_at TEXT;

-- What the model has already been asked, so the same screen is not asked about twice.
-- `key` is a hash of the task and the lines shown to the model; the lines themselves are not kept.
CREATE TABLE IF NOT EXISTS looks_done_checks (
  key        TEXT PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  verdict    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 8;
