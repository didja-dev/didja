-- Canvases (SCR-49): floating pages you keep open while you work, holding tasks sent from the list,
-- tasks added there, headings and notes, in your order. A task item points at the task itself, so it
-- is ticked (or looks done) like anywhere else. Notes and headings are your own text. Deleting a
-- canvas deletes its items, never its tasks.
CREATE TABLE canvases (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE canvas_items (
  id INTEGER PRIMARY KEY,
  canvas_id INTEGER NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task', 'note', 'heading')),
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX canvas_items_canvas ON canvas_items(canvas_id, position);
CREATE UNIQUE INDEX canvas_items_task ON canvas_items(canvas_id, task_id) WHERE task_id IS NOT NULL;

PRAGMA user_version = 19;
