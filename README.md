# Agape Kiddie City Academy ERP

A lightweight school ERP web application for Agape Kiddie City Academy, built with Node.js, Express, and **Supabase** (Postgres). All records are stored in your Supabase project.

**Live app:** https://agapekiddiecity.vercel.app

## Features

- **Dashboard Summary**: Total pupils by section (Crèche, Kindergarten, Primary), fees billed, fees collected, and outstanding balances.
- **Pupils Directory**: Add, view, search, and filter pupils by section and class (Crèche, Kindergarten 1–2, Primary 1–6).
- **Fees & Billing**: Create individual invoices or general invoices for a whole section/class, record partial/full payments (in GHS), auto-calculate balance due, and group invoices by section and class.
- **Daily Attendance**: Mark every pupil Present, Absent, or Late for any date, with a one-click "Mark All Present" option.

## Folder Structure

```
Simple ERP/
├── app.js                  # Express app (routes, static files, API)
├── server.js               # Local server entry point (app.listen)
├── api/index.js            # Vercel serverless entry point
├── vercel.json             # Vercel routing config
├── supabase.js             # Supabase client (secret key, server-side only)
├── constants.js            # Sections and class levels
├── package.json            # Node.js dependencies & scripts
├── .env                    # Your Supabase credentials (never share/commit)
├── .env.example            # Template for the .env file
├── erp.db                  # Old local database (kept only as a backup)
├── supabase/
│   └── schema.sql          # Tables, indexes and RLS policies
├── scripts/
│   ├── apply-schema.js     # Applies schema.sql using SUPABASE_DB_URL
│   └── migrate-local-to-supabase.js  # Copies erp.db into Supabase
├── routes/
│   ├── dashboard.js        # Dashboard summary API
│   ├── pupils.js           # Pupils CRUD API
│   ├── fees.js             # Fee invoices & payments API
│   └── attendance.js       # Daily attendance API
└── public/
    ├── index.html          # Main frontend page
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
```

The secret key is only used by the Express server. Never put it in frontend code or share it publicly.

## 2. Create the database tables

Choose **one** of these options.

**Option A — Supabase SQL Editor (easiest):**

1. Open **Supabase Dashboard → SQL Editor**.
2. Paste the entire contents of `supabase/schema.sql`.
3. Click **Run**.

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
```

The secret key is server-side only. Do not expose it to the browser or commit it to Git.

## Health check

`GET /api/health` returns `{ "ok": true, "database": "supabase" }` when the server can reach the database, or a helpful error when the schema is missing.

## Stopping the Server

Press `Ctrl + C` in the Command Prompt window to stop the server.

## License

MIT
