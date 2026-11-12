-- ScrolledAway shared schema, version 14: where a task was captured, so "Go to Source"
-- can take you back there after the observation itself has expired. The app and window
-- (and the page's address, for a browser) only: never what was on screen.

ALTER TABLE tasks ADD COLUMN place_bundle_id TEXT;
ALTER TABLE tasks ADD COLUMN place_app TEXT;
ALTER TABLE tasks ADD COLUMN place_window TEXT;
ALTER TABLE tasks ADD COLUMN place_url TEXT;

-- Tasks captured before this step: from their first sighting, while it is still kept.
UPDATE tasks SET
  place_bundle_id = (SELECT o.bundle_id FROM evidence e JOIN observations o ON o.id = e.observation_id
                     WHERE e.task_id = tasks.id ORDER BY e.id LIMIT 1),
  place_app       = (SELECT o.app FROM evidence e JOIN observations o ON o.id = e.observation_id
                     WHERE e.task_id = tasks.id ORDER BY e.id LIMIT 1),
  place_window    = (SELECT o.window_title FROM evidence e JOIN observations o ON o.id = e.observation_id
                     WHERE e.task_id = tasks.id ORDER BY e.id LIMIT 1),
  place_url       = (SELECT o.url FROM evidence e JOIN observations o ON o.id = e.observation_id
                     WHERE e.task_id = tasks.id ORDER BY e.id LIMIT 1);

PRAGMA user_version = 14;
