# Small Wins — a gamified daily progress tracker

A personal system that scores your day across six modules — morning tasks,
evening tasks, workouts, diet, money, and your agenda — and turns it into one
number: how disciplined today actually was.

## What's inside

| Module    | What it does |
|-----------|--------------|
| **Tasks** | To-dos split into AM and PM, each worth points. Navigate by day or choose any date, including future dates. The dashboard shows AM and PM completion as two separate bars. |
| **Money** | Set a daily spending limit, log expenses/income, set a monthly allowance that carries forward until changed, review spending pace and category trends, and manage recurring bills. Bills are forecasts until marked paid; only actual payments become expenses. Side-hustle income can be logged on the date it is earned. |
| **Body** (Workouts + Diet) | Log gym strength sessions by Push/Pull/Legs and exercises with sets, reps, and weight; log runs by duration, distance, and optional steps; and track other activities. Track protein and calories by meal, with portion-based estimates for common market foods and meat cuts. |
| **Agenda** | Time-boxed schedule items with a location and a planned duration, viewable by calendar week or any selected date. See each day's item count and estimated free minutes; completed items use actual duration, skipped/untimed items do not reserve time, and overlapping events are flagged. Record actual minutes when marking an item done or overtime. |
| **Dashboard** | The home screen: one score ring for the selected day (0–100%), a rating (**Excellent / Great / Fair / Room to Adjust**), a rolling seven-day strip with quick links to add tasks or agenda items for the selected date, and a daily check-in on your weekly focus. |
| **Stats** | Monthly line chart of your daily score, a calendar heat grid, and counts of how many Excellent/Great/Fair/Needs-Work days you've had. |
| **Goals** | Daily focus goals with a target and unit (e.g. 3 chapters). Tap **+ / −** to log progress, tap the title or the target to edit them; a goal completes itself when progress reaches the target. Weekly momentum compares this week with last week, highlights a win and one gentle next step, and stores a weekly focus on your account. Optional private sleep, energy, and stress check-ins can inform gentle recovery suggestions without affecting scores. |
| **Settings** | Streaks, badges and a dated milestone history, phone push-notification reminders, a light/dark theme toggle, editable name, public username and private email, password changes, personal scoring priorities, account deletion, and JSON export/import of your data. |

Every module also supports **editing** an entry after you've created it (click the title/details to edit — not just toggle-done and delete), a **delete confirmation** so a stray tap can't wipe an entry, and a **"copy yesterday's [tasks/workouts/meal plan/agenda]"** button when a day starts empty, so you're not retyping the same routine every morning.

## Essential features to keep in the system

These are the core features that make the app feel complete and useful for real personal growth:

- **Daily score engine**: one clear score for the whole day across tasks, workouts, diet, money, and schedule.
- **Smart planning**: AM/PM task split, daily agenda, and time-aware scheduling so you know what matters now.
- **Money tracker**: income, spending, daily limits, weekly and monthly trends, and budget awareness.
- **Monthly cash flow**: an allowance that carries forward until changed, one-time side-hustle earnings, recurring bills reserved against the balance, a gentle spending-pace estimate, and a month-to-date remaining balance. Bills stay forecasts until marked paid; only paid bills create expenses. Paused or finished bills stop future forecasts while past payments remain in the transaction history. New bills start in the current or next billing month, never in the past.
- **Savings goals and sinking funds**: create named funds with targets, record contributions and withdrawals, and see progress. Contributions reduce available cash for the month without being misreported as expenses; withdrawals release the money back into cash flow.
- **Cash-flow alerts**: optionally receive a grouped bill reminder up to seven days before the due date and a low-balance notification at a chosen threshold/time. Alerts follow the account timezone, require a registered push device, and low-balance warnings are limited to one sent alert per month.
- **Sleep and recovery**: optional daily sleep-duration, sleep-quality, energy, and stress check-ins with a weekly trend and non-clinical suggestions. Recovery entries are private and do not affect the daily score.
- **Body tracker**: workouts, cardio, sports, mobility, and diet logging in a single place.
- **Progress overview**: streaks, badges, weekly momentum, and reflection notes to keep users motivated.
- **Weekly focus check-ins**: see the current focus on the dashboard and privately note progress for each day.
- **Personal scoring**: adjust the contribution of tasks, workouts, diet, agenda, and money. Scores and streaks use the current preferences; already earned milestones remain in your history.
- **Premium analytics**: charts, calendar heatmaps, and summary metrics that show trends without overwhelming the user.
- **Shareable progress cards**: save a polished, portrait progress image with the selected day's score and actual task, movement, meal, and agenda completion counts. Copy a truthful caption or use the device share sheet for Messenger and supported social apps. Task names, budget amounts, and weekly focus are never put on the card or in its caption.
- **Reusable routines**: save named task, workout, and agenda templates, then apply them to any future date.
- **Weekly routine planning**: apply a saved task, workout, or agenda routine to selected weekdays; matching entries already on those dates are left alone.
- **Weekly planning and review**: set a weekly focus and intentional rest days, compare planned versus completed tasks/workouts/meals/agenda, and reschedule unfinished tasks or agenda items without treating empty rest days as failures.
- **Backup restore**: import a previous Small Wins JSON export and merge it into the current account safely. Export covers logged modules, weekly focus and check-ins, scoring preferences, routine templates, milestones, monthly allowances, recurring bills and payment status, savings funds and ledger entries, and recovery check-ins. Re-importing the same file never creates duplicates, and unreadable rows are skipped instead of failing the whole backup.
- **Restore preview**: review how many rows will be added, update an existing daily budget, remain unchanged, or be skipped before confirming an import.
- **Offline use**: in the local Windows app, entries save directly to the local database without internet. In a hosted browser app, the app shell and previously opened API data are saved on that device; supported creates and updates queue in that browser and replay when connection returns. Deletes, bill payments, savings-fund actions, imports, and account actions require a live server.
- **Calendar export**: download the next seven days of agenda items as an iCalendar (`.ics`) file from Agenda → Export week.
- **Calendar import**: preview a one-time `.ics` file before adding agenda entries. Duplicate items are skipped, recurring series are not expanded, and timed events are converted to the device’s local time. Imports are limited to 200 events within a 90-day range.
- **Account and data controls**: export a backup, change your password, or permanently delete your account and its database records. Hosting-provider backups may follow separate retention policies.
- **Adaptive reminders**: smart notifications avoid nudging users about work they have already completed.
- **Milestone history**: earned badges are persisted with the date you earned them (Settings → Milestone history), so a badge stays on your record even after the streak that earned it ends.
- **Mobile-first experience**: responsive layout with touch-friendly controls, fast navigation, and a clean premium feel.

This keeps the app useful as both a productivity tool and a self-improvement system instead of just a list of tasks.

**Staying motivated:** the dashboard now shows a short, honest nudge instead
of a generic pep talk — things like "You're 2 points away from Great today."
A streak counter tracks consecutive good days (with a little tolerance for
a rest day or two), and badges unlock at streak milestones, perfect days,
and level-ups. All of it is computed live from your logged data, so it's
never out of sync with what's actually on the dashboard.

**Phone notifications:** Small Wins can send real push notifications to your
phone or browser — a morning nudge, an evening check-in, and a "streak at
risk" alert if the day's about to end with nothing logged. This uses the
standard Web Push API (works on Android Chrome/Edge, desktop browsers, and
on iOS 16.4+ once the app is added to your home screen). It needs a one-time
setup step — see below — and is entirely optional; the rest of the app works
identically without it.

**Scoring, in plain terms:** every item you plan for a day is worth points.
Points you actually earn (task checked off, workout done, budget respected,
agenda item finished on time) divided by points possible = your day's
percentage. A day with nothing planned isn't scored as "poor" — it just shows
"No data," so the system only judges you on what you actually committed to.
You also earn lifetime XP and levels, shown as a bar at the top of every
screen, for a bit of a game-like pull to keep coming back.

Everything is mobile-first: bottom tab bar, big tap targets, one-column
layout that reads well on a phone.

## Stack

- **Backend:** Node.js + Express + PostgreSQL (plain SQL via `pg`, no ORM)
- **Frontend:** Vanilla HTML/CSS/JS (no build step) + Chart.js from a CDN
- **Auth:** email/password with bcrypt + JWT, since this will be reachable on
  the public internet once deployed
- One single service serves both the API and the frontend, which keeps
  Railway deployment to one click.

## Running it locally on your desktop

You need a PostgreSQL database to point the app at. Two ways to get one —
pick whichever is easier on your machine.
Use Node.js 22 or newer for local development (Node 24 is used by the
production Docker image).

## Use Small Wins offline as a Windows app

The offline setup runs the web app and PostgreSQL on your own computer.
After the one-time setup, your entries stay on that computer and the app
works without an internet connection. It does not sync to a hosted account
or to your phone.
This local database is separate from any Railway/hosted database you may
already use. To bring over existing data, export a JSON backup from the
hosted account first, then import it from Settings in your local account.

### One-time setup

1. For the simplest self-contained setup, install and start
   [Docker Desktop](https://www.docker.com/products/docker-desktop/). Its
   first setup needs internet to download the database image and build the
   app. Keep this project folder on your computer.
   Alternatively, if Node.js, npm dependencies, and PostgreSQL are already
   installed on this computer, set `DATABASE_URL` in `.env` to a local
   database. `Start-SelfUp.cmd` detects Docker; without it, the launcher
   starts the app directly against that local PostgreSQL database.
2. In PowerShell, run
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-SelfUp.ps1`.
   This adds a **Small Wins** shortcut to your Windows desktop.
3. Double-click the new shortcut (or `Start-SelfUp.cmd`). On first launch,
   it creates a private local secret, prepares the database, starts Small Wins,
   and opens a standalone app window.
4. Create your account with your name, email, and a strong password. Signup
   does not require an invitation code.
5. To install it as a browser-managed app too, open `http://localhost:3000`
   in Edge, then use **… → Apps → Install this site as an app**. You can
   launch Small Wins from the Start menu afterward.

## Install Small Wins on Android or iPhone

The hosted web app can be installed from a mobile browser; a separate Play
Store or App Store release is not required. The hosted site must use HTTPS.
Open its URL on the phone while online, then:

- **Android:** in Chrome, tap **⋮ → Install app** (or **Add to Home screen**).
- **iPhone/iPad:** in Safari, tap **Share → Add to Home Screen → Add**.

Open the installed app and sign in while online. Visit the pages whose data you
want available offline so this device can save a local copy. Previously saved
data can be viewed without a connection; supported creates and updates are
queued on that device and sync when internet returns. The offline copy may be
out of date, and deletes, imports, bill payments, savings-fund actions, and
account actions still need a live server. Offline data is stored in the
browser's site storage; logging out clears that account's saved API responses.
Uninstalling the app or clearing its browser/site data also removes local data
and any queued changes that have not synced.

When Small Wins is open, it uses only the local computer: local database,
locally served charts, and cached app files. Disconnecting Wi-Fi/Ethernet
does not stop it, and writes continue directly to the local database (they
are not held in the browser's sync queue). Docker Desktop must be running;
start the app shortcut again after restarting Windows if needed. Once the
images have been built/downloaded during setup, the shortcut starts them
without pulling or rebuilding, so routine launches work without internet.
If you change the app's source code, rebuild it once while online with
`docker compose --profile full up -d --build`. Push reminders sent through
internet push services will not work offline.

Use `Stop-SelfUp.cmd` to stop Small Wins. With Docker, this stops the app and
container but keeps data in Docker's `selfup-db-data` volume. Without Docker,
it stops only the Small Wins Node process; your PostgreSQL service stays running.
**Do not run `docker compose down -v`** in the Docker setup: that deletes the
local database and all your entries. Run
`Backup-SelfUp.cmd` to create a full PostgreSQL backup in `backups\`; copy it
to a separate drive regularly. These database backups are unencrypted, so
store them somewhere private. Settings → Export is also useful for moving
data between hosted and local accounts. Back up or export your data before
removing Docker Desktop or deleting this project.

### Option A: Docker (recommended — no Postgres install needed)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

1. Start just the database in the background:
   ```
   docker compose up -d db
   ```
2. In VS Code (or any terminal), in this folder:
   ```
   npm install
   cp .env.example .env
   ```
   The database defaults are ready for Docker. Replace the example secrets
   as described in the next step.
3. Generate a random value for `JWT_SECRET` with:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Put the value in `.env` before starting the server. Account creation is open
   to anyone who can reach the app, so keep the local server private unless you
   intend to offer public signup.
4. Start the app:
   ```
   npm run migrate
   npm run dev
   ```
   Open **http://localhost:3000** and create your account. Migrations run
   explicitly, not on each server restart.
5. When you're done:
   ```
   docker compose down       # stops the DB, keeps your data
   docker compose down -v    # stops the DB and wipes your data
   ```

Prefer to run the whole app in Docker too, with nothing installed on your
machine except Docker itself?
```
docker compose --profile full up --build
```
This builds the app from the included `Dockerfile`, runs pending migrations,
and starts it alongside the database. The fallback JWT secret in Compose is
for local development only; set `JWT_SECRET` in your shell or `.env` before
sharing the app. Open **http://localhost:3000**.
Re-run with `--build` after you change code, since the container doesn't
hot-reload.

### Option B: Native PostgreSQL install

1. Install [PostgreSQL](https://www.postgresql.org/download/) if you don't
   already have it, and create an empty database:
   ```
   createdb selfup
   ```
2. Open this folder in VS Code, then in the integrated terminal:
   ```
   npm install
   cp .env.example .env
   ```
3. Edit `.env` and point `DATABASE_URL` at your local database, e.g.:
   ```
   DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/selfup
   JWT_SECRET=<a random value of at least 32 characters>
   ```
4. Start it:
   ```
   npm run migrate
   npm run dev
   ```
   Open **http://localhost:3000** and create your account. Run `npm run migrate` after pulling an update that adds a database
   migration.

### A note on push notifications while testing locally

Web Push works fine on `localhost` in desktop browsers (Chrome/Edge/Firefox
all treat `localhost` as a secure origin), so you can generate VAPID keys
and test notifications locally too — see the section below. iOS home-screen
push still requires an actual HTTPS deployment (e.g. Railway), since Apple
doesn't support it on `localhost`.

## Enabling phone notifications (optional)

1. Generate a VAPID key pair (a one-time thing, used to sign push messages):
   ```
   npm run vapid
   ```
2. Copy the two lines it prints into `.env`:
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   ```
3. Restart the server. Open the app on your phone (or add it to your home
   screen first on iOS), go to **Settings**, and tap **Enable
   notifications**. Use **Send test notification** to confirm it reaches
   your device, then set your preferred morning/evening/streak-check times.

   Skip this section entirely if you don't want push notifications — every
   other feature works the same without it.

## Deploying to Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo**, pick the repo.
3. **Add a PostgreSQL plugin** to the project (Railway → New → Database →
   PostgreSQL). Railway automatically injects `DATABASE_URL` into your app
   service — you don't need to copy/paste it.
4. On your app service, go to **Variables** and add:
   ```
   JWT_SECRET=<generate a random value of at least 32 characters>
   TRUST_PROXY=1
   DATABASE_SSL_MODE=verify-full
   APP_URL=https://your-service.up.railway.app
   VAPID_PUBLIC_KEY=<from `npm run vapid`, optional but needed for notifications>
   VAPID_PRIVATE_KEY=<from `npm run vapid`, optional but needed for notifications>
   ```
   (`PORT` is set by Railway automatically; don't override it.)
   Production defaults to PostgreSQL TLS with certificate and hostname
   verification. If your database provider supplies a custom CA certificate,
   set `DATABASE_SSL_CA` to its PEM contents. Do not disable verification for
   a public database connection.
5. In Railway's deploy settings, set the **Pre-deploy command** to
   `npm run migrate`, and set the health-check path to
   `/api/health/ready`. `TRUST_PROXY` must match the number of trusted proxy
   hops between clients and the app; use `0` for direct local access.
6. Deploy. Railway runs the migration command before `npm start`; the server
   refuses to start without a database URL and a strong JWT secret. Open the
   generated `*.up.railway.app` URL on your phone, create your account, and add
   it to your home screen for an app-like feel (Safari/Chrome → Share → Add to
   Home Screen).
7. (Optional) Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
   `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` to enable password reset email.
   `APP_URL` must be the public HTTPS address so reset links are safe.
8. Run `npm run smoke`. Both liveness and database-backed readiness must pass
   before you start using the app.

### Backups and recovery

- Enable the database backup option available for your hosting plan and
  check its retention period. Provider backups may not be included by
  default.
- Keep periodic app exports as an additional copy (Settings → Export), but
  do not treat them as your only backup.
- For an independent PostgreSQL backup, use a trusted machine with PostgreSQL
  client tools installed:
  ```
  pg_dump --format=custom "$env:DATABASE_URL" --file selfup-backup.dump
  ```
  In PowerShell, set `DATABASE_URL` in the environment first. Keep the dump
  encrypted and private; it contains personal data.
- Periodically restore a dump into a separate, empty test database, never
  over the live database:
  ```
  pg_restore --clean --if-exists --dbname "$env:RESTORE_DATABASE_URL" selfup-backup.dump
  psql "$env:RESTORE_DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
  ```
  Confirm that you can log in and see expected records in the restored copy.
  Keep the `RESTORE_DATABASE_URL` pointed at the isolated test database.
- After restoring a backup into that separate database, set both
  `DATABASE_URL` (the live/source database) and `RESTORE_DATABASE_URL` (the
  restored copy), then run `npm run verify:restore`. The verifier refuses to
  proceed when both URLs identify the same host/database, checks core tables
  and migration records in a read-only transaction, and reports counts only.

### Account and privacy notes

Anyone who can reach the app can create an account. Do not expose a local
instance to the public internet unless you intend to allow public registration.
Email-based password recovery is optional and requires SMTP configuration.
Without it, keep a unique password in a password manager and keep data
exports/backups current. The in-app [privacy
notice](./public/privacy.html) summarizes what Small Wins stores and the
third-party assets loaded by the UI.
Account deletion removes live account records, while hosting backups may
retain older copies under their separate policies.

## Extending it later

- `schema.sql` is the immutable initial database migration. For future
  schema changes, add a numbered SQL file such as
  `migrations/005_add_example_column.sql`, then run `npm run migrate` (or
  configure it as the deployment pre-deploy command). Applied migrations are
  recorded in `schema_migrations` and are not rerun on each app boot.
- `utils/scoring.js` is the one place all scoring math lives. Want workouts
  to count for more, or a streak bonus? Change it there and every screen
  (dashboard, stats, XP) updates automatically.
- Each module is a self-contained route file (`routes/*.js`) and a
  self-contained frontend page (`public/js/pages/*.js`) — easy to extend one
  without touching the others.
- `utils/streaks.js` and `utils/motivation.js` control streak/badge logic
  and the wording of nudges and push notifications, respectively — tune the
  thresholds or copy there without touching scoring.
- `utils/scheduler.js` is the cron job that fires reminders; it reuses
  `utils/summaries.js` (the same day/range queries the dashboard uses) so
  notification content always matches what's on screen.
- The Agenda page can preview and import one-time events from iCalendar files; the import is explicit, duplicate-aware, and does not expand recurring event rules.
- Offline changes remain in the browser until accepted by the server. Use the connectivity banner’s **Review queued changes** action to inspect errors and retry; failed changes are not silently discarded.

## Running tests

Run `npm test` for unit tests. The account/API integration test also exercises
database-backed imports and calendar exports when `TEST_DATABASE_URL` points
to a migrated PostgreSQL test database; otherwise that test is skipped.
For browser flows, install Playwright's Chromium once with
`npx playwright install chromium`, then run `npm run test:e2e`. Browser tests
use the database configured by `DATABASE_URL` and start the app on port 4173.

## Recent upgrades

- **Premium UI layer** (`public/js/ui.js`): toasts with undo, styled dialogs, confetti/haptics, quick-add button, smooth page/day transitions, sliding nav.
- **Recurring tasks:** choose "Every day / Weekdays / Weekends" when adding a task. Due tasks are generated automatically (`utils/recurring.js`); a task you delete on purpose is never regenerated. Tables are created automatically on start.
- **Installable + offline support:** `public/manifest.json`, icons, a caching service worker, and per-account IndexedDB snapshots for previously loaded API data.
- **Hardening:** async error handling, database-backed auth rate limits, security headers, stronger new-password requirements, and fail-fast production configuration checks. Set `CORS_ORIGIN` (comma-separated) to restrict browser access to approved site origins.
- **Account recovery:** optional SMTP-based password reset with one-hour, single-use tokens and revocation of existing sessions after a reset.
- **Deployment checks:** database-aware readiness and liveness endpoints, a post-deploy smoke check (`APP_URL=... npm run smoke`), and CI tests on Node 22/24.
- **Operations:** PostgreSQL-backed shared rate limits, advisory-locked reminder runs with durable delivery records, graceful HTTP/scheduler/database shutdown, structured logs without request bodies or query strings, and a read-only restore verifier.
- **Planning and accessibility:** saved weekly rest days, completion-versus-plan review, task and agenda carry-over, small-start onboarding, visible offline retry details, and keyboard focus management for dialogs.
- Reminder delivery records prevent concurrent duplicate sends and retry failed attempts after a short lease. The scheduler catches up for up to 10 minutes after a pause; a process crash after a push provider accepts a message but before Small Wins records success can still produce a rare duplicate, since those two systems cannot share one transaction.
#   S m a l l - w i n s  
 