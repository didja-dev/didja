-- Didja shared schema, version 31 (SCR-97): when a task is due.
--
-- `due_at` is a local calendar day ("YYYY-MM-DD"), read by the engine from the words of the email or
-- chat message that made the task, relative to the message's date. Null when none was named, or the
-- words could mean more than one day. It orders the list, brings a snoozed task back on the day and
-- gives one reminder (`due_nudged_at`); it never ticks anything.

ALTER TABLE tasks ADD COLUMN due_at TEXT;
ALTER TABLE tasks ADD COLUMN due_nudged_at TEXT;
-- A chat ask waiting for a reply of yours (SCR-45) keeps its day until it becomes a task.
ALTER TABLE chat_pending ADD COLUMN due TEXT;

PRAGMA user_version = 31;
