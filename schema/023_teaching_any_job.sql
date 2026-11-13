-- Didja shared schema, version 23 (SCR-71): what you taught, for any job and any kind of lesson.
-- The tables from step 13 only allowed four jobs and two kinds of lesson (a CHECK on each), and
-- SQLite cannot change a CHECK. These tables have none: the engine decides what goes in them.
-- What was there is copied once, ids kept; the old tables stay, no longer written.
-- brain_jobs: your own instructions for a job. lesson_notes: your corrections, shown to the model
-- as examples ("not-an-action", "not-done", "renamed").

CREATE TABLE IF NOT EXISTS brain_jobs (
  job          TEXT PRIMARY KEY,
  instructions TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
INSERT OR IGNORE INTO brain_jobs (job, instructions, updated_at) SELECT job, instructions, updated_at FROM brain;

CREATE TABLE IF NOT EXISTS lesson_notes (
  id         INTEGER PRIMARY KEY,
  job        TEXT NOT NULL,   -- lists, titles, emails, chats, looks-done
  kind       TEXT NOT NULL,   -- not-an-action, not-done, renamed
  key        TEXT NOT NULL,   -- what it matches: a task's dedupe key, or an email's sender and base subject
  example    TEXT NOT NULL,   -- the sentence shown to the model
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO lesson_notes (id, job, kind, key, example, created_at) SELECT id, job, kind, key, example, created_at FROM lessons;
CREATE INDEX IF NOT EXISTS lesson_notes_job ON lesson_notes(job, kind, key);

PRAGMA user_version = 23;
