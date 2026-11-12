-- Related tasks from different places (a Teams message and the DocuSign email it announced):
-- ScrolledAway suggests merging them; merged, they show as one and finish together.
ALTER TABLE tasks ADD COLUMN merged_into INTEGER REFERENCES tasks(id);

CREATE TABLE merge_suggestions (
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  other_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  -- suggested | merged | rejected
  status     TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, other_id)
);

PRAGMA user_version = 15;
