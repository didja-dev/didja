-- How a task looked where it was captured (SCR-31): a few lines before and after it, as text,
-- kept with the task while it is open and deleted when it is done or dismissed. This is the
-- one place screen text outlives the 24-hour observations, chosen by the maintainer (docs/DECISIONS.md).
CREATE TABLE task_context (
  task_id      INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  bundle_id    TEXT,
  app          TEXT,
  window_title TEXT,
  url          TEXT,
  -- JSON: [{"text": "...", "task": true|false}], the task's own line marked
  lines        TEXT NOT NULL,
  captured_at  TEXT NOT NULL
);

PRAGMA user_version = 16;
