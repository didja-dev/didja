-- Chat asks waiting to become tasks (SCR-45). An ask from someone else waits 10 minutes: a reply of
-- yours in that chat in the meantime means it was answered live, and it is dropped. Holds the
-- model's wording of the task and who asked, never the message itself. A row lives 10 minutes,
-- or until a reply of yours drops it; anything older than a day is deleted.
CREATE TABLE chat_pending (
  key            TEXT PRIMARY KEY,
  app            TEXT NOT NULL,
  chat           TEXT NOT NULL,
  sender         TEXT NOT NULL,
  title          TEXT NOT NULL,
  at             TEXT NOT NULL,    -- when the message was sent (ISO)
  observation_id INTEGER,
  ts             TEXT NOT NULL,    -- the reading it was seen in (ISO)
  created_at     TEXT NOT NULL
);

PRAGMA user_version = 18;
