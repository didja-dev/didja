-- "What done looks like" (SCR-67): what the on-device model said, when the task was captured, a
-- screen showing it done would have. JSON: {"where": [...], "success": [...], "pending": [...],
-- "tokens": [...]}, each a short phrase written by the model; "{}" when it was asked and had
-- nothing. NULL until asked. Cleared when the task is done or dismissed, like its kept lines.
ALTER TABLE tasks ADD COLUMN criteria_model TEXT;

PRAGMA user_version = 22;
