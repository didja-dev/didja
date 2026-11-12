-- Canvas items have a level (SCR-49): 0 at the left, up to 4 indents, as in an outline.
ALTER TABLE canvas_items ADD COLUMN level INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 20;
