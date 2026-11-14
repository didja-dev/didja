-- Didja shared schema, version 32 (SCR-99): Waiting On.
--
-- An ask you sent someone ("Can you send me the signed contract?") is kept here, never in `tasks`:
-- it is not your task, so no tick path can reach it and it is never counted. It is quiet until
-- `quiet_until`, then gives one reminder (`nudged_at`). It closes as answered when a message from
-- that person arrives in the same chat or email conversation after the ask, or when you say
-- "Got it" or "Stop waiting". Closed rows are deleted after 24 hours; open ones 30 days after the ask.
--
-- `title` is engine-written ("Waiting on Sam: the signed contract"); `who` is the person as the chat
-- or email names them; `place` is the chat's name or the email's subject (reply prefixes aside).
-- `closed_why` says how it closed ("Sam replied in WhatsApp — Sam Carter at 10:42").

CREATE TABLE IF NOT EXISTS waiting (
  id           INTEGER PRIMARY KEY,
  key          TEXT NOT NULL UNIQUE,
  via          TEXT NOT NULL,
  app          TEXT NOT NULL,
  place        TEXT NOT NULL,
  who          TEXT NOT NULL,
  who_address  TEXT,
  direct       INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL,
  asked_at     TEXT NOT NULL,
  quiet_until  TEXT NOT NULL,
  nudged_at    TEXT,
  status       TEXT NOT NULL DEFAULT 'waiting',
  closed_at    TEXT,
  closed_why   TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS waiting_open ON waiting (status, app, place);

PRAGMA user_version = 32;
