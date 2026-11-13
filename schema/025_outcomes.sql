-- Didja shared schema, version 25 (SCR-73): what happened to each task, for "How Didja is doing".
-- One row per step and event: ticked for you (and how), asked "looks done?" and the answer, done by
-- hand, shown done in Didja Missed This, dismissed, Not an Action, Fresh Start, reopened after a
-- tick. Counts only: no titles, no text. `outcomes_since` says from when they are recorded.

CREATE TABLE IF NOT EXISTS outcomes (
  id      INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  ts      TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outcomes_ts ON outcomes(ts);
CREATE INDEX IF NOT EXISTS outcomes_task ON outcomes(task_id, id);
INSERT OR IGNORE INTO meta (key, value) VALUES ('outcomes_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 25;
