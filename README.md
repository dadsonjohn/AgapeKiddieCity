# Agape Kiddie City Academy ERP

A lightweight school ERP web application for Agape Kiddie City Academy, built with Node.js, Express, and **Supabase** (Postgres). All records are stored in your Supabase project.

**Live app:** https://agapekiddiecity.vercel.app

## Features

- **Accounts & Roles**: Log in or sign up. The first account becomes the administrator; every later sign-up is a teacher. Admins manage pupils, fees, and team accounts. Teachers can add pupils, view the directory, and take attendance; deleting a pupil requires administrator approval.
- **Dashboard Summary**: Total pupils by section (Crèche, Kindergarten, Primary) and by class (Kindergarten 1–2, Primary 1–6), plus fees billed, fees collected, and outstanding balances (admins only).
- **Pupils Directory**: Add, view, search, and filter pupils by section and class. An optional birthday can be recorded. Duplicate pupil names are rejected, and guardian phone numbers must be exactly 10 digits.
- **Fees & Billing**: Create individual invoices or general invoices for a whole section/class, record partial/full payments (in GHS), auto-calculate balance due, and group invoices by section and class. Every payment saves a printable receipt with the school name, pupil, date, amount, balance, and a stamp space.
- **Daily Attendance**: Mark every pupil Present, Absent, or Late for any date, with a one-click "Mark All Present" option. The attendance page shows present counts per class and a daily attendance history.

## Accounts and roles

| Role | Can do |
| --- | --- |
| **Admin** | Everything: dashboard fee totals, pupils (add/edit/delete), approve or reject teacher delete requests, fees and payments, attendance, and team accounts. |
| **Teacher** | Add pupils, view the pupil directory, take/edit attendance, and request a pupil deletion. Fees, money totals, pupil editing, and direct deletion are hidden and blocked by the API. |

- Open the app and choose **Sign Up** for the first account. That account becomes the **Admin**.
- Later sign-ups automatically become **Teachers**.
- An admin can open **Team** to promote a teacher to admin, demote an admin, or remove an account.
- Sessions last 7 days and are stored in a signed, HTTP-only cookie.

## Folder Structure

```
Simple ERP/
├── app.js                  # Express app (routes, static files, API)
├── server.js               # Local server entry point (app.listen)
├── api/index.js            # Vercel serverless entry point
├── vercel.json             # Vercel routing config
├── auth.js                 # Session cookies + role middleware
├── supabase.js             # Supabase client (secret key, server-side only)
├── constants.js            # Sections and class levels
├── package.json            # Node.js dependencies & scripts
├── .env                    # Your Supabase credentials (never share/commit)
├── .env.example            # Template for the .env file
├── erp.db                  # Old local database (kept only as a backup)
├── supabase/
│   ├── schema.sql          # Full schema for a fresh database
│   └── apply-updates.sql   # Idempotent update for an existing database
├── scripts/
│   ├── apply-schema.js     # Applies schema.sql using SUPABASE_DB_URL
│   └── migrate-local-to-supabase.js  # Copies erp.db into Supabase
├── routes/
│   ├── auth.js             # Login, signup, logout, account management API
│   ├── dashboard.js        # Dashboard summary API
│   ├── pupils.js           # Pupils CRUD API
│   ├── fees.js             # Fee invoices & payments API
│   └── attendance.js       # Daily attendance API
└── public/
    ├── index.html          # Main frontend page (login + app)
    ├── styles.css          # Styling
    └── app.js              # Frontend JavaScript
```

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or newer (needed by the one-time migration script)
- A Supabase project — create one at [supabase.com](https://supabase.com)

## 1. Configure Supabase credentials

Open **Supabase Dashboard → Project Settings → API Keys** and copy:

- Project URL
- Publishable key
- Secret key

Create a `.env` file in this folder (or copy `.env.example`) and fill it in:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_JWKS_URL=https://your-project-ref.supabase.co/auth/v1/.well-known/jwks.json

# Optional but recommended: a long random string used to sign login cookies.
# If omitted, the server falls back to SUPABASE_SECRET_KEY.
SESSION_SECRET=replace-with-a-long-random-string

# Optional: Hellio Messaging (SMS) — needed for the Messages tab
HELLIO_API_TOKEN=your-hellio-api-token
HELLIO_DEFAULT_SENDER=YourApprovedSenderID
HELLIO_BASE_URL=https://api.helliomessaging.com/v1
```

The secret key is only used by the Express server. Never put it in frontend code or share it publicly.

## 2. Create the database tables

Choose **one** of these options.

**Option A — Supabase SQL Editor (easiest):**

1. Open **Supabase Dashboard → SQL Editor**.
2. Paste the entire contents of `supabase/schema.sql`.
3. Click **Run**.

> **Already have a database?** Paste `supabase/apply-updates.sql` into the SQL
> Editor and run it once. It adds the optional birthday column, saved receipts,
> teacher delete requests, the strict duplicate-pupil trigger, the
> 10-digit guardian-phone rule, and the SMS message history tables. It is safe
> to run more than once. The API keeps working before the update is applied, but
> birthdays, receipts, delete requests, and SMS history are only saved after it
> is run.

**Option B — from the terminal:**

Add your database connection string to `.env` (Supabase Dashboard → Project Settings → Database → Connection string → URI):

```
SUPABASE_DB_URL=postgresql://postgres.your-project-ref:<password>@<host>:5432/postgres
```

Then run:

```
npm run setup
```

## 3. Migrate your existing local data (optional)

Your old data still lives in `erp.db`. To copy it into Supabase:

```
npm run migrate
```

If Supabase already contains data and you want to replace it:

```
npm run migrate -- --force
```

The local `erp.db` is never modified, so it remains available as a backup.

## 4. Run the app

```
npm start
```

You should see:

```
Connected to Supabase at https://your-project-ref.supabase.co
Agape Kiddie City Academy ERP running at http://localhost:3000
```

Open http://localhost:3000 in your browser.

If the server reports that tables are missing, repeat step 2.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the app |
| `npm run setup` | Apply `supabase/schema.sql` using `SUPABASE_DB_URL` |
| `npm run migrate` | Copy `erp.db` into Supabase |
| `npm run migrate -- --force` | Wipe Supabase data, then copy `erp.db` |

## 5. Deploy to Vercel

The repository is connected to Vercel, so every push to `main` deploys automatically.

- **Production URL:** https://agapekiddiecity.vercel.app
- **Vercel project:** https://vercel.com/dadsonjohn/agape-kiddie-city
- **Entry point:** `api/index.js` (exports the Express app from `app.js`)
- **Routing:** `vercel.json` sends every request to the Express function

Add these environment variables in **Vercel → Project → Settings → Environment Variables** (Production and Preview):

```
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
SUPABASE_JWKS_URL
SESSION_SECRET
```

`SESSION_SECRET` is optional; when omitted, the server signs login cookies with
`SUPABASE_SECRET_KEY`. The secret key is server-side only. Do not expose it to
the browser or commit it to Git.

## Health check

`GET /api/health` returns `{ "ok": true, "database": "supabase" }` when the server can reach the database, or a helpful error when the schema is missing.

## Stopping the Server

Press `Ctrl + C` in the Command Prompt window to stop the server.

## License

MIT
