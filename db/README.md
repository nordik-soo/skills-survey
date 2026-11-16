# Sault Survey — PostgreSQL (Docker)

PostgreSQL 16 running in Docker Desktop, with the 6-table survey schema loaded
automatically on first start.

## Files
- `../docker-compose.yml` — Postgres + Adminer (web DB browser) services
- `../.env` — database name / user / password / ports
- `init/01_schema.sql` — the schema (runs automatically the first time the DB starts)
- `init/02_submitted_column.sql` — adds `respondents.submitted` to a database that
  already exists (safe to run more than once)

## Run it

1. Start **Docker Desktop** and wait until it says "Engine running".
2. From the project folder (`c:\Users\NazmulHossen\sss`):

   ```powershell
   docker compose up -d
   ```

3. Check it's healthy:

   ```powershell
   docker compose ps
   ```

## Connect

| Setting  | Value            |
|----------|------------------|
| Host     | `localhost`      |
| Port     | `5432`           |
| Database | `sault_survey`   |
| User     | `sault`          |
| Password | `sault_dev_password` |

- **Browser (Adminer):** http://localhost:8080  → System: *PostgreSQL*, Server: `db`, then the user/password/database above.
- **psql in the container:**

  ```powershell
  docker exec -it sault_survey_db psql -U sault -d sault_survey
  ```

- **Connection string:** `postgresql://sault:sault_dev_password@localhost:5432/sault_survey`

## Common commands

```powershell
docker compose logs -f db      # watch logs
docker compose stop            # stop (keeps data)
docker compose start           # start again
docker compose down            # remove containers (keeps data in the named volume)
docker compose down -v         # remove containers AND wipe the database
```

## Reloading the schema

The init script in `init/` runs **only when the data volume is empty** (first start).
If you change `01_schema.sql` and want it re-applied from scratch:

```powershell
docker compose down -v
docker compose up -d
```

(That deletes all data — use it only in development.)

## The `submitted` column on an existing database

`02_submitted_column.sql` is already applied by `01_schema.sql` on a new database
(the column is in both files); it exists so a database that predates the column can
be brought up to date **without wiping it**. Run it once against production
(Railway → Postgres → *Query*), or locally with:

```powershell
docker exec -i sault_survey_db psql -U sault -d sault_survey < db/init/02_submitted_column.sql
```

Existing rows keep their `completed_at`, so they read `Yes`/`No` the moment the
column is added, and no other table or column changes.
