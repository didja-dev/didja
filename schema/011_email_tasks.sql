-- ScrolledAway shared schema, version 11: which task an email became.
-- An email is known by a hash of its sender, subject and time, never its text.
-- Reading the same email again updates its task instead of making another.

CREATE TABLE IF NOT EXISTS email_tasks (
  mail_key TEXT PRIMARY KEY,
  task_id  INTEGER NOT NULL
);

PRAGMA user_version = 11;
