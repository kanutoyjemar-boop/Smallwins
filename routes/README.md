# SelfUp — a gamified daily discipline tracker

A personal system that scores your day across six modules — morning tasks,
evening tasks, workouts, diet, money, and your agenda — and turns it into one
number: how disciplined today actually was.

## What's inside

| Module    | What it does |
|-----------|--------------|
| **Tasks** | To-dos split into AM and PM, each worth points. The dashboard shows AM and PM completion as two separate bars, exactly as you asked for. |
| **Money** | Set a daily spending limit, log expenses/income. Staying under budget earns points. |
| **Body** (Workouts + Diet) | Log gym/walk/run/pickleball/etc. with duration, and a meal plan (Breakfast/Lunch/Dinner/Snack) you check off as you eat it. |
| **Agenda** | Time-boxed schedule items with a location and a planned duration, viewable as Today / Tomorrow / +2 / +3 days. Mark each "Done on time," "Ran over," or "Skipped." |
| **Dashboard** | The home screen: one score ring for the day (0–100%), a rating (**Excellent / Great / Fair / Growing**), and a quick-glance grid of every module. The score is a guide, not a judgment. |
| **Stats** | Monthly line chart of your daily score, a calendar heat grid, and counts of how many Excellent/Great/Fair/Needs-Work days you've had. |
| **Settings** | Streaks, badges, phone push-notification reminders, a light/dark theme toggle, editable name/email, a change-password form, and a one-click export of everything you've logged as a JSON file. |

Every module also supports **editing** an entry after you've created it (click the title/details to edit — not just toggle-done and delete), a **delete confirmation** so a stray tap can't wipe an entry, and a **"copy yesterday's [tasks/workouts/meal plan/agenda]"** button when a day starts empty, so you're not retyping the same routine every morning.

## Essential features to keep in the system

These are the core features that make the app feel complete and useful for real personal growth:

- **Daily score engine**: one clear score for the whole day across tasks, workouts, diet, money, and schedule.
- **Smart planning**: AM/PM task split, daily agenda, and time-aware scheduling so you know what matters now.
- **Money tracker**: income, spending, daily limits, weekly and monthly trends, and budget awareness.
- **Body tracker**: workouts, cardio, sports, mobility, and diet logging in a single place.
- **Progress overview**: streaks, badges, weekly momentum, and reflection notes to keep users motivated.
- **Premium analytics**: charts, calendar heatmaps, and summary metrics that show trends without overwhelming the user.
- **Social accountability**: shareable accomplishments for Facebook and Instagram so discipline becomes a habit worth celebrating.
- **Reusable routines**: save named task, workout, and agenda templates, then apply them to any future date.
- **Backup restore**: import a previous SelfUp JSON export and merge it into the current account safely.
- **Adaptive reminders**: smart notifications avoid nudging users about work they have already completed.
- **Milestone history**: earned badges are persisted so accomplishments remain part of the user's story.
- **Mobile-first experience**: responsive layout with touch-friendly controls, fast navigation, and a clean premium feel.

**Install it like an app:** SelfUp ships a web app manifest, home-screen icons
and a small offline-capable service worker. On a phone, open the deployed URL
and use *Add to Home Screen* — it launches full-screen with its own icon, and
still opens (showing your last-loaded screens) with no connection.

**Backups:** *Settings → Export my data* downloads everything — tasks, money,
workouts, diet, agenda, goals, reflections, saved routines and earned
milestones. *Import backup* validates the file and merges it safely: rows that
already exist are skipped, so importing the same file twice never duplicates
anything. Saved routines can be removed from the *Manage saved* list on the
Tasks, Body and Agenda pages, and goal progress is adjusted with the − / +
buttons on the Goals page.

This keeps the app useful as both a productivity tool and a self-improvement system instead of just a list of tasks.

**Staying motivated:** the dashboard now shows a short, honest nudge instead
of a generic pep talk — things like "You're 2 points away from Great today."
A streak counter tracks consecutive good days (with a little tolerance for
a rest day or two), and badges unlock at streak milestones, perfect days,
and level-ups. All of it is computed live from your logged data, so it's
never out of sync with what's actually on the dashboard.

**Phone notifications:** SelfUp can send real push notifications to your
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
   The defaults in `.env.example` already match the Docker database
   (`postgresql://postgres:postgres@localhost:5432/selfup`), so you usually
   don't need to edit anything — just make sure `JWT_SECRET` is set to some
   random string.
3. Start the app:
   ```
   npm run dev
   ```
   The schema migration runs automatically on boot. Open
   **http://localhost:3000** and create your account.
4. When you're done:
   ```
   docker compose down       # stops the DB, keeps your data
   docker compose down -v    # stops the DB and wipes your data
   ```

Prefer to run the whole app in Docker too, with nothing installed on your
machine except Docker itself?
```
docker compose --profile full up --build
```
This builds the app from the included `Dockerfile` and runs it alongside
the database. Open **http://localhost:3000**. Re-run with `--build` after
you change code, since the container doesn't hot-reload.

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
   JWT_SECRET=any-long-random-string
   ```
4. Start it:
   ```
   npm run dev
   ```
   The app runs the schema migration automatically on boot — no separate
   migration step needed. Open **http://localhost:3000** and create your
   account.

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
   JWT_SECRET=<generate a long random string>
   VAPID_PUBLIC_KEY=<from `npm run vapid`, optional but needed for notifications>
   VAPID_PRIVATE_KEY=<from `npm run vapid`, optional but needed for notifications>
   ```
   (`PORT` is set by Railway automatically; don't override it.)
5. Deploy. Railway runs `npm install` then `npm start`, which runs the schema
   migration and boots the server. Open the generated `*.up.railway.app` URL
   on your phone, create your account, and add it to your home screen for an
   app-like feel (Safari/Chrome → Share → Add to Home Screen).

## Extending it later

- `schema.sql` is the single source of truth for the database — edit it and
  redeploy; it re-runs safely on every boot (`CREATE TABLE IF NOT EXISTS`).
- `utils/scoring.js` is the one place all scoring math lives. Want workouts
  to count for more, or a streak bonus? Change it there and every screen
  (dashboard, stats, XP) updates automatically.
- Each module is a self-contained route file (`routes/*.js`) and a
  self-contained frontend page (`public/js/pages/*.js`) — easy to extend one
  without touching the others.
- `utils/streaks.js` and `utils/motivation.js` control streak/badge logic
  and the wording of nudges and push notifications, respectively — tune the
  thresholds or copy there without touching scoring.
- `npm run migrate` applies `schema.sql` on its own (the server also does this
  on boot). `npm test` runs the unit tests, including backup validation.
- `utils/backup.js` validates imports; add new tables there and in
  `routes/export.js` to include them in backups.
- `utils/scheduler.js` is the cron job that fires reminders; it reuses
  `utils/summaries.js` (the same day/range queries the dashboard uses) so
  notification content always matches what's on screen.
