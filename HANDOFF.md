# Handoff: Agape Kiddie City Academy ERP

This document is a full context handoff for another developer or AI model continuing work on this project. It covers what the app is, what was built, where everything lives, how to run and deploy it, and what remains.

---

## 1. What the project is

A lightweight school ERP web app for **Agape Kiddie City Academy**.

- **Purpose:** manage pupils, school fees/invoices/payments, and daily attendance.
- **Stack:** Node.js + Express (CommonJS), vanilla HTML/CSS/JS frontend, Supabase (Postgres) for storage.
- **Repo:** https://github.com/dadsonjohn/AgapeKiddieCity (branch `main`)
- **Local folder:** `C:\Users\Deedew\Desktop\Simple ERP`
- **Local URL:** http://localhost:3000
- **Production URL:** https://agapekiddiecity.vercel.app
- **Vercel project:** https://vercel.com/dadsonjohn/agape-kiddie-city
- **Old production URL:** `agape-kiddie-city.vercel.app` — now 307-redirects to `agapekiddiecity.vercel.app`.

> 🔐 **Authentication is enabled.** Accounts use Supabase Auth (email + password). The first account created becomes the **Admin**; every later sign-up is a **Teacher**. Admins manage pupils, fees, and team accounts. Teachers can view the pupil directory and take attendance. See section 7 for details.

---

## 2. Original user requirements (all implemented)

1. Rename the school from "Simple School ERP" to **Agape Kiddie City Academy**.
2. Fix dashboard totals (Fees Billed / Fees Collected / Outstanding) so they update when invoices/payments change.
3. Hide monetary amounts by default behind a small **eye button**; click to reveal.
4. Add class levels:
   - Crèche (section level only)
   - Kindergarten 1–2
   - Primary 1–6
5. Support **general/group invoices** for all pupils / a section / a class, with invoices arranged by section and class.
6. Daily attendance for **every pupil**, every day.
7. Move the database from local SQLite to **Supabase** (`npm install @supabase/server` was requested; see the compatibility note below — final implementation uses `@supabase/supabase-js`).
8. Deploy to **Vercel**.
9. Change the domain to **agapekiddiecity.vercel.app**.
10. Make the deployed link visible on GitHub.
11. Commit/push all changes to GitHub.

### Follow-up requirements (implemented)

12. Add login and sign-up with two profiles: **Admin** and **Teacher**.
    - First account = Admin; later accounts = Teacher.
13. Reject duplicate pupil entries.
14. Restrict the guardian phone to exactly 10 digits (numbers only).

---

## 3. Architecture

```
Browser (vanilla JS)  →  Express API  →  Supabase Postgres
                         │
                         ├─ local: server.js → app.listen(3000)
                         └─ Vercel: api/index.js (serverless function)
                                    ▲
                          vercel.json rewrites all paths to /api
```

- `app.js` builds and exports the Express app (routes + static files + SPA fallback).
- `server.js` is the local entry point: `require('./app')`, checks the DB, `app.listen`.
- `api/index.js` is the Vercel entry point: `module.exports = require('../app')`.
- The server uses the Supabase **secret key** (bypasses RLS). The key never reaches the browser; all DB access is server-side.
- Accounts live in **Supabase Auth** (`auth.users`); roles are stored in each user's `user_metadata.role`. Password hashing and email/password login are handled by Supabase.
- `auth.js` signs a 7-day HTTP-only session cookie (HMAC-SHA256) and exposes `requireAuth` / `requireAdmin` middleware. The cookie secret is `SESSION_SECRET` or, if unset, `SUPABASE_SECRET_KEY`.
- The browser loads the SPA shell, then calls `GET /api/auth/me`. Unauthenticated visitors see the login/sign-up screen. Every data API is protected server-side.
- Frontend is served by Express from `public/`. On Vercel, `public/**` is bundled into the function via `vercel.json` `includeFiles`.

### Why not `@supabase/server`

`@supabase/server`'s CommonJS build `require()`s the ESM-only `jose` package, which crashes on Vercel's Node runtime with `ERR_REQUIRE_ESM` / `FUNCTION_INVOCATION_FAILED`. The project now creates the client directly:

```js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
```

Do not reintroduce `@supabase/server` without testing the Vercel deployment.

---

## 4. File map

| Path | Purpose |
|---|---|
| `app.js` | Express app: JSON middleware, static `public/`, `/api/health`, API routers, SPA fallback |
| `server.js` | Local entry point (`app.listen`, connection check + logs) |
| `api/index.js` | Vercel serverless entry (exports `app.js`) |
| `vercel.json` | `functions.includeFiles: public/**`; rewrite `/(.*)` → `/api` |
| `.vercelignore` | Keeps `.env`, `erp.db`, logs, `node_modules`, `.git` out of Vercel uploads |
| `auth.js` | Supabase auth client, signed session cookie, `attachUser`, `requireAuth`, `requireAdmin` |
| `supabase.js` | Creates the Supabase client and `checkConnection()` |
| `constants.js` | `SECTIONS`, `CLASS_LEVELS`, `CLASS_ORDER`, `SECTION_ORDER`, `sectionForClass`, `normalizeClassLevel`, `sectionRank`, `classRank` |
| `routes/helpers.js` | `fail`, `parseId`, `comparePupils`, `mapInvoice`, `compareInvoices` |
| `routes/auth.js` | Signup, login, logout, `/me`, admin account management |
| `routes/pupils.js` | Pupil CRUD + section/class/search filtering + duplicate/phone validation |
| `routes/fees.js` | Invoice listing, single + bulk invoices, payments |
| `routes/attendance.js` | Roster/date reads, single + bulk upserts, summary |
| `routes/dashboard.js` | Dashboard totals and per-section pupil counts |
| `supabase/schema.sql` | Full schema, indexes, RLS, `service_role` grants |
| `scripts/apply-schema.js` | Applies `schema.sql` over `SUPABASE_DB_URL` (`npm run setup`) |
| `scripts/migrate-local-to-supabase.js` | One-time copy of `erp.db` into Supabase (`npm run migrate`) |
| `public/index.html` | Single-page UI (login/sign-up, Dashboard, Pupils, Fees, Attendance, Team) |
| `public/app.js` | All frontend logic (auth, role UI, masking, filters, modals, grouped fees, attendance auto-save) |
| `public/styles.css` | Styling, grouped invoice view, eye button, attendance, responsive rules |
| `README.md` | Public setup + deployment docs (includes the live URL) |
| `erp.db` | Old SQLite database, kept only as a backup; gitignored |
| `.env` | Real credentials; gitignored. **Never commit or paste publicly.** |
| `.env.example` | Credential template |

---

## 5. Database schema (Supabase)

Project ref: `yrowehlvxhnjdowohtmd` → `https://yrowehlvxhnjdowohtmd.supabase.co`
Org/project display name: `Agape Kiddie City Academy` (free plan)

```sql
sections(id bigint pk, name text unique, created_at timestamptz)

pupils(
  id bigint pk,
  full_name text not null,
  section text not null,             -- 'Crèche' | 'Kindergarten' | 'Primary'
  class_level text,                  -- 'Crèche' | 'Kindergarten 1-2' | 'Primary 1-6'
  guardian_name text not null,
  guardian_phone text not null,
  enrollment_status text default 'Active',
  created_at timestamptz
)

fee_invoices(
  id bigint pk,
  pupil_id bigint fk → pupils(id) on delete cascade,
  term text not null,
  academic_year text not null,
  description text,
  amount_billed numeric(12,2) default 0,
  amount_paid   numeric(12,2) default 0,
  status text default 'Unpaid',      -- 'Unpaid' | 'Partial' | 'Paid'
  created_at timestamptz
)

payments(
  id bigint pk,
  invoice_id bigint fk → fee_invoices(id) on delete cascade,
  amount_paid numeric(12,2) default 0,
  payment_date timestamptz default now(),
  note text
)

attendance(
  id bigint pk,
  pupil_id bigint fk → pupils(id) on delete cascade,
  attendance_date date not null,
  status text default 'Present',     -- 'Present' | 'Absent' | 'Late'
  created_at timestamptz,
  unique (pupil_id, attendance_date)
)
```

Indexes exist on pupils.section, pupils.class_level, fee_invoices.pupil_id, fee_invoices(term, academic_year), payments.invoice_id, attendance.attendance_date, attendance.pupil_id.

Accounts are stored in **Supabase Auth** (`auth.users`), not in a custom table. Each user's `user_metadata.role` is `'admin'` or `'teacher'`, and `user_metadata.full_name` holds the display name. Supabase handles password hashing, email confirmation (bypassed on signup via `admin.createUser`), and password login.

`supabase/schema.sql` also adds:
- `pupils_guardian_phone_10_digits` — `check (guardian_phone ~ '^[0-9]{10}$')`
- `pupils_unique_name_phone_idx` — unique on `(lower(btrim(full_name)), guardian_phone)`

> If the database predates the accounts/validation work, re-run `schema.sql` once in the Supabase SQL Editor. The API enforces both rules independently, so nothing breaks before the SQL is re-run.

**RLS is enabled with no public policies.** Only the `service_role` (secret key) can read/write. The publishable/anon key cannot access data.

Important data rules:
- `fee_invoices.amount_paid` is the **source of truth** for collected fees. The `payments` table is an audit log of individual payments.
- Bulk invoice creation skips pupils who already have an invoice for the **same term + academic year**, regardless of amount/description.
- Attendance uses an upsert on `(pupil_id, attendance_date)`.
- Deleting a pupil cascades to their invoices, payments, and attendance.
- Guardian phone must be exactly 10 digits. The API rejects anything else and the form strips non-digits as you type.
- A pupil is rejected as a duplicate when the name matches and either the guardian phone matches, or the same guardian name + section + class match. The database unique index is a second safety net.
- The first account to sign up becomes Admin; later accounts become Teacher. An admin can change roles on the Team page. The last admin cannot be demoted or deleted, and admins cannot change/delete their own account.
- Role changes take effect on the affected user's next login (the signed cookie carries the role for up to 7 days). Removing an account blocks future logins; an existing cookie remains valid until it expires.

---

## 6. API endpoints

All return JSON. Errors: `{ "error": "message" }` with an appropriate status.

### Authentication endpoints

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/signup` | Public | `full_name`, `email`, `password`; first account = admin, later = teacher |
| POST | `/api/auth/login` | Public | `email`, `password`; sets the session cookie |
| POST | `/api/auth/logout` | Public | Clears the session cookie |
| GET | `/api/auth/me` | Signed in | Returns the current user |
| GET | `/api/auth/users` | Admin | Lists all accounts |
| PATCH | `/api/auth/users/:id` | Admin | `{ role: "admin" \| "teacher" }`; cannot change own role or remove the last admin |
| DELETE | `/api/auth/users/:id` | Admin | Removes an account; cannot delete self or the last admin |

### Data endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok: true, database: "supabase" }` or 503 with hint |
| GET | `/api/dashboard/summary` | `totalPupils`, `pupilsPerSection[]`, `totalBilled`, `totalCollected`, `outstandingBalance` |
| GET | `/api/pupils` | Optional `?section=`, `?class_level=`, `?search=` (name/guardian) |
| GET | `/api/pupils/:id` | Single pupil |
| POST | `/api/pupils` | `full_name`, `section`, `class_level`, `guardian_name`, `guardian_phone`, `enrollment_status` |
| PUT | `/api/pupils/:id` | Update pupil |
| DELETE | `/api/pupils/:id` | Delete pupil (cascades) |
| GET | `/api/fees` | All invoices with pupil name/section/class and `balance_due`, sorted by section/class/name |
| POST | `/api/fees` | Single invoice: `pupil_id`, `term`, `academic_year`, `amount_billed`, `description` |
| POST | `/api/fees/bulk` | General invoice: `target` (`all` / section / class), `term`, `academic_year`, `amount_billed`, `description` → `{created, skipped, total_billed}` |
| GET | `/api/fees/:id` | Single invoice |
| POST | `/api/fees/:id/payments` | `{ amount_paid, note }`; updates invoice status and appends to `payments` |
| GET | `/api/fees/:id/payments` | Payment history (newest first) |
| DELETE | `/api/fees/:id` | Delete invoice (cascades payments) |
| GET | `/api/attendance` | Optional `?date=YYYY-MM-DD&section=&class_level=` |
| GET | `/api/attendance/date/:date` | Attendance for a date |
| POST | `/api/attendance` | Upsert one: `pupil_id`, `attendance_date`, `status` |
| POST | `/api/attendance/bulk` | Upsert many: `pupil_ids[]`, `attendance_date`, `status` |
| GET | `/api/attendance/summary/:date` | Per-section `total_pupils`, `total_marked`, `present`, `absent`, `late` |
| DELETE | `/api/attendance/:id` | Delete a record |

Role rules enforced in `app.js` and the routers:
- `/api/fees/*` — **admin only** (403 for teachers).
- `POST/PUT/DELETE /api/pupils/*` — **admin only**; `GET /api/pupils` is available to both roles.
- `/api/attendance/*` and `/api/dashboard/summary` — any signed-in user. The dashboard returns fee totals only to admins (`null` for teachers).
- All data endpoints return 401 when there is no valid session.

---

## 7. UI behavior details

- **Login / Sign Up:** full-screen auth card with two tabs. Sign-up asks for full name, email, password, and confirmation. The first account becomes Admin; later accounts become Teacher. The header shows the signed-in name, role badge, and a Log Out button.
- **Role-based UI:** teachers see Dashboard, Pupils, and Attendance only. Fees/Team links, money cards, Add Pupil, and pupil Edit/Delete controls are hidden. The API enforces the same rules.
- **Team (admin):** list accounts, promote/demote with a role dropdown, and remove accounts. Your own role/remove controls are disabled.
- **Dashboard:** total pupils + per-section table; Fees Billed / Collected / Outstanding masked by default (`GHS ••••`) with an eye toggle ("Show amounts" / "Hide amounts"). Fee cards are admin-only.
- **Fees:** same eye toggle. Grouped by section block (Crèche, Kindergarten, Primary) and then by class, with per-group totals. Buttons: **General Invoice**, **Individual Invoice**, per-row **Pay** / **Delete**.
- **Pupils:** table with section and class filters, search, add/edit modal. Class dropdown options depend on the selected section (`CLASS_LEVELS` in `constants.js`). The guardian phone field accepts digits only and enforces exactly 10; duplicate names + guardian phones (or same name/guardian/class) are rejected with a clear message.
- **Attendance:** date picker, section/class filters, summary cards per section, full roster for the chosen date. Changing a pupil's status saves automatically (no submit button). **Mark All Present** bulk-marks the currently listed pupils. Unmarked pupils show "Not marked".
- Amount masking is **client-side display only** (the data is still in the API response).

---

## 8. Running locally

Prerequisites: Node.js 22+ (the migration script uses `node:sqlite`; develop/tested on Node 26).

```bash
npm install
npm start          # http://localhost:3000
```

`npm start` reads `.env` (via dotenv) and should print:

```
Connected to Supabase at https://<project>.supabase.co
Agape Kiddie City Academy ERP running at http://localhost:3000
```

Open http://localhost:3000 and choose **Sign Up**. The first account becomes the **Admin**. Later sign-ups are **Teachers**; an admin can promote them from the **Team** page.

The local server currently running on port 3000 was started **before** the `app.js` refactor. It works, but restart it (`Ctrl+C`, then `npm start`) to load the current code.

### Environment variables (`.env`, gitignored)

```
SUPABASE_URL=https://yrowehlvxhnjdowohtmd.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SECRET_KEY=<secret key>
SUPABASE_JWKS_URL=https://yrowehlvxhnjdowohtmd.supabase.co/auth/v1/.well-known/jwks.json

# Optional but recommended: long random string for signing login cookies.
# Falls back to SUPABASE_SECRET_KEY when omitted.
SESSION_SECRET=<long random string>

# Optional: only for `npm run setup` (applying schema.sql from the terminal)
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
```

The real values are in `.env` locally and in **Vercel → Project → Settings → Environment Variables** (Production + Preview). Retrieve them from there; never commit or paste the secret key.

> Security note: the Supabase secret key was shared in the original chat. If that chat or this handoff is shared outside the trusted team, rotate the key in Supabase and update `.env` + Vercel.

### Database setup / migration commands

```bash
npm run setup                  # apply supabase/schema.sql (needs SUPABASE_DB_URL)
npm run migrate                # copy erp.db into Supabase (refuses if Supabase has data)
npm run migrate -- --force     # wipe Supabase rows, then copy erp.db
```

The schema was already applied via the Supabase SQL Editor and the local data was migrated. `erp.db` is untouched.

---

## 9. Deployment (Vercel)

- Connected via GitHub integration to `dadsonjohn/AgapeKiddieCity`, branch `main`.
- Every push to `main` triggers a production deployment automatically.
- Framework preset: **Express**. `vercel.json` routes all requests to `api/index.js`.
- Environment variables set for **Production and Preview**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`. `SESSION_SECRET` is optional (falls back to `SUPABASE_SECRET_KEY`).
- Production domain: `agapekiddiecity.vercel.app`; editing it in **Settings → Domains** created a 307 redirect from the old `agape-kiddie-city.vercel.app`.
- The GitHub repo's **Website** field and **About** description point to the live app; `README.md` also includes the live link.

### Deploy-time pitfall

A commit can show a stale **Error** status in the Vercel deployments list while the deployment detail says **Ready** and serves correctly. Confirm with the domain and `/api/health` rather than relying on the list chip.

### Health checks

```bash
curl https://agapekiddiecity.vercel.app/api/health
# {"ok":true,"database":"supabase"}

curl https://agapekiddiecity.vercel.app/api/dashboard/summary
# {"totalPupils":11,...,"totalBilled":22300,"totalCollected":13600,"outstandingBalance":8700}
```

---

## 10. Git history

```
2644be6  Add admin/teacher authentication and pupil validation
37d81f5  Add full project handoff documentation
f36c24a  Document live deployment and agapekiddiecity.vercel.app domain
073b1aa  Use @supabase/supabase-js for Vercel compatibility
174de9b  Add Vercel serverless deployment support
44b29c9  Migrate database to Supabase
92c960e  Initial commit for School ERP
```

Working tree was clean and `main` matched `origin/main` after the auth/validation push.

---

## 11. Current data state (Supabase)

- Pupils: **10** — Crèche 1, Kindergarten 3, Primary 6.
- Fee invoices: **10**.
- Payments: **8**.
- Attendance: **10** records.
- Accounts: **0** at the time this handoff was updated. The first sign-up becomes Admin.
- Dashboard: **Billed 19,900 / Collected 11,900 / Outstanding 8,000** (GHS).

Existing pupils were backfilled to default class levels (`Kindergarten 1`, `Primary 1`, Crèche → `Crèche`). The user can edit them to the correct levels.

### Test-looking data that was migrated as-is (not yet cleaned)

- **John Dadson** has two invoices for term `1` / academic year `2026`:
  - 1,200 billed / 2,000 paid (Paid)
  - 5,000 billed / 2,500 paid (Partial, description "Fees")
- **Ama Mensah** has 1,200 billed / 1,700 paid (overpaid by 500).

The user was told about these and has not asked to remove them. Do not delete without confirmation.

---

## 12. Verification approach used

- `node --check` on server and route files.
- Local `GET /api/health`, `/api/dashboard/summary`, `/api/pupils`, `/api/fees`.
- A temporary end-to-end test created a pupil + invoice + payment + attendance, confirmed dashboard totals changed, then deleted the pupil and confirmed totals returned to baseline.
- Authentication matrix (22 checks): first signup → admin, later signup → teacher, login/wrong password, `/me`, admin fees access, teacher 403 on fees and pupil writes, teacher dashboard hides money, admin user list/promote/demote, duplicate pupil rejection, invalid/short phone rejection, and cleanup of temporary accounts.
- Browser checks of the login screen, admin dashboard (money + eye toggle), pupil create/duplicate alert, Team page, and the teacher view (hidden Fees/Team/Add/Edit controls, attendance roster) locally.
- `GET /api/health` on both the new domain and the old (redirect) domain.

There is **no automated test suite**. Add one if the project grows.

---

## 13. Conventions and constraints

- CommonJS (`require` / `module.exports`), async/await, Express 4.
- Route modules are factories: `module.exports = ({ supabase }) => { const router = express.Router(); ... return router; }`.
- Use `fail(res, err, message)` for 500 responses and `parseId` for numeric IDs.
- Sort pupils/invoices by section rank, then class rank, then name (`routes/helpers.js` + `constants.js`).
- Keep `section` as `Crèche` / `Kindergarten` / `Primary`; `class_level` holds the finer class.
- Preserve the accented `Crèche` spelling everywhere.
- Use Supabase Auth for accounts; roles live in `user_metadata.role`. Do not add a separate passwords table.
- Protect every new data route with `requireAuth`, and use `requireAdmin` for financial or destructive operations.
- Keep the session cookie `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Never put the session secret in `public/`.
- Validate guardian phone as exactly 10 digits on both the client and the server, and keep the duplicate-pupil check in `routes/pupils.js` in sync with the DB index.
- Do not expose the secret key to `public/` or commit `.env`.
- Keep `vercel.json`/`.vercelignore` intact; removing `includeFiles` breaks static assets on Vercel.
- After changes, run `node --check` and verify the affected API endpoints. Commit and push to `main` when the user wants it deployed.

---

## 14. Suggested next steps (optional)

1. **Clean test data** (John Dadson duplicate invoices, Ama Mensah overpayment) — only with user approval.
2. **Custom domain** (e.g. `agapekiddiecity.com`): buy/connect it in Vercel → Settings → Domains and update DNS + GitHub/README links.
3. **Password reset / change password** — not implemented yet; Supabase Auth supports reset emails and `updateUser`.
4. **Immediate session revocation** — role changes and account deletion currently take effect at next login or cookie expiry (7 days). Add a per-request Supabase check or shorter TTL if that matters.
5. Add receipt printing/export (PDF/CSV) and a payments report if requested.
6. Consider an automated test for bulk invoicing, attendance upserts, and auth/role rules.
