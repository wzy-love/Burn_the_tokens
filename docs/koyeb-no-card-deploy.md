# Koyeb + GitHub Pages (No-card-first) deployment

This guide is for your current setup:
- frontend on GitHub Pages
- backend on Koyeb

## 1) Deploy backend to Koyeb

1. Sign in to Koyeb and create a new Web Service from GitHub.
2. Select repository: `wzy-love/Burn_the_tokens`.
3. Set service root directory to `backend`.
4. Build command:

```bash
npm install && npm run db:generate && npm run db:push
```

5. Start command:

```bash
npm run start
```

6. Environment variables (minimum):

```bash
PORT=4000
DATABASE_URL=file:./dev.db
LOG_LEVEL=info
JWT_ACCESS_SECRET=<strong-random-secret>
JWT_REFRESH_SECRET=<strong-random-secret>
JWT_ACCESS_EXPIRES_IN=2h
JWT_REFRESH_EXPIRES_IN=14d
ADMIN_KEY=<your-admin-key>
CORS_ORIGINS=https://wzy-love.github.io
```

7. Deploy and copy the public backend URL, for example:

`https://<your-koyeb-service>.koyeb.app`

8. Validate backend:

```bash
https://<your-koyeb-service>.koyeb.app/healthz
https://<your-koyeb-service>.koyeb.app/api/game/leaderboard
```

## 2) Configure GitHub Pages build variables

In GitHub repository `Settings -> Secrets and variables -> Actions -> Variables`, add:

- `VITE_API_BASE` = `https://<your-koyeb-service>.koyeb.app/api`
- `VITE_BASE_PATH` = `/Burn_the_tokens/`

## 3) Enable Pages and run workflow

1. In repository `Settings -> Pages`, set Source to `GitHub Actions`.
2. In `Actions`, run workflow `Deploy Frontend to GitHub Pages`.

Final URL:

`https://wzy-love.github.io/Burn_the_tokens/`

## Notes

- Koyeb free resources are for hobby/testing and may have limits.
- `DATABASE_URL=file:./dev.db` uses local file storage in the service container; long-term persistence is not guaranteed on free plans.
- If you need stable persistent data, move database to managed Postgres.
