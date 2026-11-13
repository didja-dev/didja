-- Didja shared schema, version 24 (SCR-72): one window identity for capture and the engine.
-- Capture writes each observation's window key (Differ.windowKey: the app plus the page, or the
-- title without spinners, unread counts and "— Edited"), and the engine reads a window's history
-- by it, so a title that changes doesn't split a window and two pages with one title stay apart.
-- Rows from before this step keep '' and are grouped by app and exact title, as before.

ALTER TABLE observations ADD COLUMN window_key TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS observations_window_key ON observations(window_key, id);

PRAGMA user_version = 24;
