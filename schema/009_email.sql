-- ScrolledAway shared schema, version 9: emails that need a reply.
-- Remembers which emails the on-device model has already been asked about, by a
-- hash of sender, subject and date. The emails themselves are not kept here.

CREATE TABLE IF NOT EXISTS email_checks (
  key        TEXT PRIMARY KEY,
  verdict    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 9;
