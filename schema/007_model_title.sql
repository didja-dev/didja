-- ScrolledAway shared schema, version 7: a short title for a checklist, written
-- by the on-device model when the line that introduced it is a long sentence.
-- Shown unless you gave the item your own name. '' means "asked, nothing usable".

ALTER TABLE tasks ADD COLUMN model_title TEXT;

PRAGMA user_version = 7;
