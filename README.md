# Sault Newcomer Skills Survey

A short, anonymous web survey that collects skills, education, and employment
information from newcomers to Sault Ste. Marie and the Algoma District, to help
local organizations plan workforce-development and training programs.

It is a small full‑stack app:

- **Front end** — static HTML/CSS/JS (no framework), one question at a time, with
  consent + eligibility gating, branching questions, a self‑rated skills matrix,
  and a gift‑card draw opt‑in.
- **API** — Node/Express, serves the site and writes each submission into PostgreSQL.
- **Database** — PostgreSQL, a 6‑table schema (one respondent row + five section tables).
- **Admin console** — passcode‑protected dashboard with live stats and a one‑click
  CSV export (all tables joined, one row per respondent).

Everything runs together with Docker Compose.

---

## Quick start (Docker)

Requires **Docker Desktop**.

```bash
# 1. create your local env file from the template and fill in real values
cp .env.example .env        # (Windows PowerShell: copy .env.example .env)

# 2. start Postgres + API + Adminer
docker compose up -d --build
```

Then open:

| What | URL |
| --- | --- |
| Survey | http://localhost:3000 |
| Admin console | http://localhost:3000/#/admin |
| Adminer (browse tables) | http://localhost:8080 |

The admin passcode is whatever you set as `ADMIN_PASSCODE` in `.env`.

Adminer login: System **PostgreSQL**, Server **db**, the user/password/database from `.env`.

### Common commands

```bash
docker compose ps              # status
docker compose logs -f api     # watch API logs
docker compose down            # stop (data is kept in the pgdata volume)
docker compose up -d --build   # rebuild + restart after changes
```

Front‑end edits (`index.html`, `app.js`, `app.css`, `survey-data.js`) are mounted
live — just refresh the browser. API edits (`api/server.js`) need
`docker compose up -d --build api`.

---

## Environment (`.env`)

Copy `.env.example` → `.env` and set:

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Database credentials |
| `POSTGRES_PORT` / `ADMINER_PORT` / `API_PORT` | Host ports (defaults 5432 / 8080 / 3000) |
| `ADMIN_PASSCODE` | Gates the admin console + CSV export (server‑validated) |
| `SESSION_SECRET` | Signs the admin login cookie |

Generate strong values:

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"  # ADMIN_PASSCODE
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"        # SESSION_SECRET
```

`.env` is git‑ignored and **must not be committed**.

---

## Survey flow

1. **Consent** — must confirm 18+ and agree to participate (declining ends the survey).
2. **Eligibility** — moved to Northern Ontario after Dec 2021.
3. **Section A – Demographics**, **B – Education**, **C – Employment**,
   **D – Skills** (9 self‑rated 1–5), **E – Barriers & Challenges**.
4. **Gift‑card draw** — optional opt‑in + email.

Branching questions (province, non‑permanent‑resident category, occupation group,
job‑search details) only appear when relevant.

---

## Database schema (6 tables)

| Table | Holds |
| --- | --- |
| `respondents` | consent, eligibility, gift‑card opt‑in + email, timestamps |
| `section_a_demographics` | gender, age, identity groups |
| `section_b_education` | credential, program, institution, year |
| `section_c_employment` | status, income, occupation, job‑search |
| `section_d_skills` | 9 skill ratings + local opportunity knowledge |
| `section_e_barriers_challenges` | barriers, support needs, challenges |

Each section table has a `UNIQUE respondent_id` → respondents (1:1, cascade delete).
The schema lives in [`db/init/01_schema.sql`](db/init/01_schema.sql) and runs
automatically on first DB startup.

---

## API

Public (respondents):

- `POST /api/start` — create a respondent row (tracks "started")
- `POST /api/submissions` — save a full submission into all 6 tables

Protected (admin session required):

- `POST /api/login` / `POST /api/logout` / `GET /api/me` — passcode auth (httpOnly cookie)
- `GET /api/stats` — dashboard counts + 14‑day series
- `GET /api/export.csv` — one row per respondent, all tables joined

---

## Security notes

- The admin passcode is **server‑validated**; it is never shipped in the client code.
- Login issues a **signed, httpOnly, SameSite=Lax** session cookie (12h; `Secure`
  added automatically over HTTPS).
- `/api/stats` and `/api/export.csv` return **401** without a valid session — only
  people with the passcode can view or export responses.
- The export contains the gift‑card **email (PII)** — share it carefully.
- Access is a single shared passcode (admin + collaborators). Per‑person logins can
  be added later if individual revocation/audit is needed.

---

## Project structure

```
.
├── index.html            # survey + admin SPA (hash routing)
├── app.js                # survey flow, admin dashboard, API calls
├── app.css               # app styles
├── colors_and_type.css   # design tokens (colors, type, spacing)
├── survey-data.js        # questionnaire definition
├── assets/  fonts/        # logo, map artwork, self-hosted fonts
├── api/
│   ├── server.js         # Express API + static host
│   ├── Dockerfile
│   └── package.json
├── db/init/01_schema.sql # 6-table schema (auto-loaded on first boot)
├── docker-compose.yml    # db + api + adminer
└── .env.example          # copy to .env
```

`server.py` is a static‑only preview (no database) — use **localhost:3000** for the
full app.

---

## Deployment (Railway)

The stack maps cleanly to [Railway](https://railway.app):

1. Push this repo to GitHub (done).
2. New project → add the **PostgreSQL** plugin (provides `DATABASE_URL`).
3. Deploy the **API** from `api/Dockerfile`; set env vars `DATABASE_URL`,
   `ADMIN_PASSCODE`, `SESSION_SECRET`, `PORT=3000`.
4. Run `db/init/01_schema.sql` once against the Railway database (managed Postgres
   does not auto‑run the init script).
5. Don't deploy Adminer in production.

Railway provides HTTPS, so the session cookie's `Secure` flag activates automatically.
