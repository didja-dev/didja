-- ScrolledAway shared schema, version 5: the on-device model's verdicts on lists
-- whose wording does not say who they are for.

-- One verdict per distinct list. `key` is a hash of the list's lead-in and steps;
-- the list's text itself is not kept here.
CREATE TABLE IF NOT EXISTS judgements (
  key        TEXT PRIMARY KEY,
  audience   TEXT NOT NULL CHECK (audience IN ('user', 'assistant')),
  model      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Lists waiting to be judged. A list that is still being written keeps one slot
-- (its source and title), so only its settled form is judged. Rows are deleted
-- as soon as they are judged.
CREATE TABLE IF NOT EXISTS pending_judgements (
  slot       TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  payload    TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

PRAGMA user_version = 5;
