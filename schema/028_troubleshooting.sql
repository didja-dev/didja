-- Didja shared schema, version 28 (SCR-79): what the troubleshooting report reads, codes and counts only.
--
-- `capture_outcomes`: what happened when capture tried the app in front. One row per run of the same
-- result in the same app: a repeat moves `last_ts` on and counts it in `n`. `result` is a code
-- ('ok', 'no-focused-window', 'ax-tree-empty', 'excluded', 'ocr-used', 'ocr-denied', 'paused',
-- 'not-trusted', …) and `lines` how many lines were read; never the lines themselves, never a window
-- title. Written by the app, kept 24 hours and at most 500 rows.
--
-- `engine_drops`: per hour, per source kind, how many lists or messages the engine saw and why each
-- did not become a task ('no-list', 'claude-own', 'checking', 'no-model', 'older', 'not-for-you',
-- 'not-an-action', 'waiting'), with 'read' for windows read and 'seen' for lists or messages found.
-- Counts only; what became a task is counted from the tasks themselves.
-- Written by the engine's full pass, kept 24 hours.

CREATE TABLE IF NOT EXISTS capture_outcomes (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL,
  last_ts   TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  app       TEXT NOT NULL,
  result    TEXT NOT NULL,
  lines     INTEGER NOT NULL DEFAULT 0,
  n         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS capture_outcomes_app ON capture_outcomes(bundle_id, id);

CREATE TABLE IF NOT EXISTS engine_drops (
  hour   TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour, source, reason)
);

PRAGMA user_version = 28;
