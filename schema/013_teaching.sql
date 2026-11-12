-- ScrolledAway shared schema, version 13: what you have taught it.
-- brain: your own instructions for one of the on-device model's jobs, replacing
-- the built-in ones. lessons: corrections you made ("not an action", "not done"),
-- shown to the model as examples and, for "not an action", never captured again.

CREATE TABLE IF NOT EXISTS brain (
  job          TEXT PRIMARY KEY CHECK (job IN ('lists', 'titles', 'emails', 'looks-done')),
  instructions TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id         INTEGER PRIMARY KEY,
  job        TEXT NOT NULL CHECK (job IN ('lists', 'titles', 'emails', 'looks-done')),
  kind       TEXT NOT NULL CHECK (kind IN ('not-an-action', 'not-done')),
  key        TEXT NOT NULL,   -- what it matches: a task's dedupe key, or an email's base subject
  example    TEXT NOT NULL,   -- the sentence shown to the model
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lessons_job ON lessons(job, kind, key);

PRAGMA user_version = 13;
