-- Didja shared schema, version 26 (SCR-75): how long each task event took, for "How fast it is".
-- One row per new task, tick for you, and "looks done?" asked by the engine, with three wall-clock
-- times: `seen_at` (the screen showed it: the observation's time), `engine_at` (the pass that
-- handled it began) and `shown_at` (the task or tick was written). `path` is the target it is
-- measured against: 'fast' (≤3 s), 'model' (≤10 s) or 'wait' (a chat ask's deliberate wait for your
-- reply). Times only: no titles, no text. Evidence keeps its own screen time.

CREATE TABLE IF NOT EXISTS timings (
  id        INTEGER PRIMARY KEY,
  task_id   INTEGER NOT NULL,
  event     TEXT NOT NULL,   -- 'task' | 'tick' | 'asked'
  path      TEXT NOT NULL,   -- 'fast' | 'model' | 'wait'
  seen_at   TEXT,
  engine_at TEXT NOT NULL,
  shown_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS timings_shown ON timings(shown_at);
INSERT OR IGNORE INTO meta (key, value) VALUES ('timings_since', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

PRAGMA user_version = 26;
