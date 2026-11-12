-- ScrolledAway shared schema, version 6: deeper hierarchy, renaming, collapsing.
-- parent_id (version 3) already allows any depth; these columns are what the
-- nested, editable list needs on top of it.

ALTER TABLE tasks ADD COLUMN custom_title TEXT;                 -- your own name for an item; the captured title is kept for matching
ALTER TABLE tasks ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;  -- whether a parent's children are folded away
ALTER TABLE tasks ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;   -- 1 when the engine can tick this by itself

PRAGMA user_version = 6;
