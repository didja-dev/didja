-- ScrolledAway shared schema, version 4: snoozed tasks come back on their own.

ALTER TABLE tasks ADD COLUMN snoozed_until TEXT;  -- ISO 8601, UTC; set while status = 'snoozed'

PRAGMA user_version = 4;
