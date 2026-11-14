-- Didja shared schema, version 30 (SCR-96): why a task was made, kept with it when it is captured.
--
-- `captured_why` is one plain line written by the engine, such as "A list from Claude handed to you
-- by its own wording" or "Someone tagged or named you in a group and asked you to do something; the
-- model read it as an ask". Never screen text: no message words, no list titles, no names of people.
-- How sure Didja is (sure, possibly yours, checking) is read from the task's confidence when it is shown.
-- Tasks from before this step have none.

ALTER TABLE tasks ADD COLUMN captured_why TEXT;
-- A chat ask waiting for a reply of yours (SCR-45) keeps its reason until it becomes a task.
ALTER TABLE chat_pending ADD COLUMN why TEXT;

PRAGMA user_version = 30;
