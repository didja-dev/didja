-- ScrolledAway shared schema, version 12: "looks done" accepted for you.
-- When you choose to accept "looks done" automatically, a task ticked that way
-- keeps where it looked done, so it can be labelled and, if you reopen it, not
-- ticked from that place again.

ALTER TABLE tasks ADD COLUMN accepted_from TEXT;

PRAGMA user_version = 12;
