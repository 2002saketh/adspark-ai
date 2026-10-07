# D1 migrations

`0001_initial_schema.sql` reproduces the current AdSpark SQLite schema. The
local SQLite database remains the Node/Vite development store. Wrangler's local
D1 database is used to exercise the D1 adapter and migration independently.

No SQLite data is imported. Production schema application is a separate,
explicit step and must use the existing `adspark-production` database. Do not
create a replacement database. The `database_id` in `wrangler.jsonc` is still a
placeholder because the current local Wrangler credentials cannot authenticate
to Cloudflare; replace it only after resolving that access and confirming the
existing database ID.
