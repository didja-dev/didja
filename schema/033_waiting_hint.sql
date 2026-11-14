-- Didja shared schema, version 33 (SCR-109): a waiting item that may have been answered elsewhere.
--
-- A message from the person you are waiting on, in another app, naming the same thing (an id, a file,
-- an amount, a link) as the ask, does not close the item: it only marks it "answered?" until you say
-- Got it or Stop waiting. `hint` is engine-written ("Dana wrote in Microsoft Outlook at 10:42 about
-- INV-2041"): the person's first name, the app, the time and the thing the waiting title already
-- names; never the message.

ALTER TABLE waiting ADD COLUMN hint TEXT;
ALTER TABLE waiting ADD COLUMN hint_at TEXT;

PRAGMA user_version = 33;
