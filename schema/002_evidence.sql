-- ScrolledAway shared schema, version 2: evidence says what was seen and why it counts.
-- `detail` is a description written by the engine ("Ran `supabase db push` in Ghostty"),
-- never raw screen text, so it stays meaningful after its observation expires.

ALTER TABLE evidence ADD COLUMN kind TEXT NOT NULL DEFAULT 'captured';  -- 'captured' | 'marker'
ALTER TABLE evidence ADD COLUMN marker TEXT;                            -- the marker that was seen
ALTER TABLE evidence ADD COLUMN detail TEXT;

PRAGMA user_version = 2;
