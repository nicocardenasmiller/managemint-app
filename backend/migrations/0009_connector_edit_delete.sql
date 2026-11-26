-- Nov 2026: the assistant connector can now change and delete tasks. Assistants approved before this were approved
-- for less, so they are signed out once and asked to approve again (with the new wording).
UPDATE connector_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE revoked_at IS NULL;
