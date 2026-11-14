-- Didja shared schema, version 29 (SCR-95): the Suggested tray.
--
-- With Capture set to Everything, a borderline ask (today: a group chat message that asks something
-- but names nobody) is kept here instead of becoming a task. A suggestion is not a task: it is never
-- ticked, never counted and never nudges. Accept makes it a task; Not an Action teaches as on a task;
-- after 24 hours it is deleted without a trace.
--
-- `title` is the engine-written title (never the message). `ask` is what Accept needs to make the
-- task: the app, conversation, sender, when it was sent, the observation id and the title, as JSON.

CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  title      TEXT NOT NULL,
  ask        TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 29;
