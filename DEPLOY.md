# Deploying SelfUp (Railway)

## 1. Push the code
Commit everything and push to GitHub, then create a Railway project from the repo.
Railway builds the included `Dockerfile`. On every start the container applies any
pending database migrations (`node scripts/migrate.js`) and then launches the server.

## 2. Add a database
Add a **PostgreSQL** plugin to the project and reference its URL from the app service
as `DATABASE_URL` (Railway offers this as a variable reference). The private
`*.railway.internal` address needs no TLS setting; a public address is verified with
TLS automatically.

## 3. Set these variables on the app service

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | From the Postgres plugin. |
| `JWT_SECRET` | yes | 32+ random characters. Changing it signs everyone out. |
| `APP_URL` | for password reset | Your public URL, e.g. `https://yourapp.up.railway.app`. |
| `SIGNUP_INVITE_CODE` | optional | If set, new accounts need this code. Leave unset for open sign-up. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional | Phone/browser notifications. Generate with `npm run vapid`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | optional | Without these, "Forgot password" is unavailable. |
| `CORS_ORIGIN` | optional | Only needed if another website must call the API. The app's own pages do not need it. |

You do **not** need to set `TRUST_PROXY` on Railway (it defaults to one proxy hop
there), `NODE_ENV` (set by the Dockerfile) or `PORT` (set by Railway).
Set `TRUST_PROXY` yourself only on a different host, matching the number of proxies in front of the app.

Generate a secret:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. Verify
- `GET /api/health/live` returns `{"ok":true}` as soon as the process is up.
- `GET /api/health/ready` returns `{"ok":true,"database":"ready"}` once the database is reachable and migrated.
- Create an account, add a task, reload the page.

## Before every release
```
npm ci
npm test                 # unit tests (database tests are skipped without TEST_DATABASE_URL)
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/selfup_test npm test   # include DB integration tests, use a throwaway database
npx playwright install chromium && npm run test:e2e   # browser tests
```
Bump the `CACHE` version in `public/sw.js` whenever files in `public/` change, so installed copies refresh.

## Security notes
- Never commit `.env`, `.env.local`, `backups/` or `*.dump`; they are git-ignored.
- The Content-Security-Policy forbids inline scripts and inline event handlers. Put new scripts in `public/js/` and attach listeners with `addEventListener`; a test enforces this.
