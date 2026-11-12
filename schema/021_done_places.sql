-- Where a step was done, as you told Didja ("Didja Missed This…"). A place is a web host, or an
-- app's name when the screen has no address. From then on, "looks done" also checks screens there
-- for the other steps from the same conversation (`source`), and for steps that name the same app
-- word (`word`, e.g. "planner"). It only lets those screens be looked at: the model must still see
-- the step done, and nothing is ticked from a place you did not name.
CREATE TABLE done_places (
  id INTEGER PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  source INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  word TEXT,
  site TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX done_places_site ON done_places(site);

PRAGMA user_version = 21;
