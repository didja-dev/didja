-- Didja shared schema, version 27 (SCR-74): trust earned where "looks done?" keeps being right.
-- One row per answer that counts: 'yes' (you said it was done there, or showed it done in Didja
-- Missed This) and 'no' (you said not yet, or reopened a task Didja ticked for you). `key` is the
-- site or app, the task's source kind and its first verb ("vercel.com · claude-desktop · set"):
-- no titles, no screen text.

CREATE TABLE IF NOT EXISTS trust_events (
  id   INTEGER PRIMARY KEY,
  key  TEXT NOT NULL,
  kind TEXT NOT NULL,   -- 'yes' | 'no'
  ts   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trust_events_key ON trust_events(key, ts);

PRAGMA user_version = 27;
