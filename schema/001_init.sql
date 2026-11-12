-- ScrolledAway shared schema, version 1.
-- Applied by whichever side (app or engine) opens the database first.
-- Capture writes observations; the engine reads them and writes tasks.

CREATE TABLE IF NOT EXISTS observations (
  id           INTEGER PRIMARY KEY,
  ts           TEXT NOT NULL,              -- ISO 8601, UTC
  bundle_id    TEXT NOT NULL,
  app          TEXT NOT NULL,
  window_title TEXT NOT NULL DEFAULT '',
  url          TEXT,
  source       TEXT NOT NULL CHECK (source IN ('ax', 'ocr')),
  text         TEXT NOT NULL               -- only the lines new since this window's last snapshot
);
CREATE INDEX IF NOT EXISTS observations_ts ON observations(ts);
CREATE INDEX IF NOT EXISTS observations_window ON observations(bundle_id, window_title, id);

CREATE TABLE IF NOT EXISTS sources (
  id   INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  ref  TEXT NOT NULL,
  UNIQUE (kind, ref)
);

CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  source       INTEGER NOT NULL REFERENCES sources(id),
  criteria     TEXT,
  markers      TEXT NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'done', 'dismissed', 'snoozed')),
  confidence   REAL NOT NULL DEFAULT 0,
  dedupe_key   TEXT NOT NULL UNIQUE,
  position     INTEGER,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS evidence (
  id             INTEGER PRIMARY KEY,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  observation_id INTEGER REFERENCES observations(id) ON DELETE SET NULL,
  ts             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_task ON evidence(task_id);
CREATE INDEX IF NOT EXISTS evidence_observation ON evidence(observation_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA user_version = 1;
