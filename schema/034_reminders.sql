-- Didja shared schema, version 34 (SCR-121): tasks written to Apple Reminders.
--
-- One row per task Didja wrote to Reminders (opt-in, Settings › Connections). `reminder_id` is the
-- reminder's identifier in Reminders; a reminder without a row here (one you made yourself) is never
-- touched. `synced` is the state both sides last agreed on ('open' or 'done'), so a change on one side
-- is told from a change on the other and each is carried across once.

CREATE TABLE reminder_links (
  task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  reminder_id TEXT NOT NULL UNIQUE,
  written_at TEXT NOT NULL,
  synced TEXT NOT NULL DEFAULT 'open'
);

PRAGMA user_version = 34;
