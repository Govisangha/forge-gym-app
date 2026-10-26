# Forge

Personal, mobile-first training app with a two-week rotation, fast offline set logging, Beat This progression, permanent workout snapshots, calendar history, exercise history, PBs, bodyweight, and generic CSV/JSON plus dedicated six-file Planfit import.

## GitHub → Cloudflare Pages

Create a **private** repository named `forge-gym-app` under `Govisangha`, then push this source directory. Do not upload the deployment ZIP as the repository source.

In Cloudflare, create a **Pages** project using **Connect to Git** and select the repository. A project originally created by direct ZIP upload cannot be converted to Cloudflare's built-in Git integration, so create a new project and keep the old one until this works.

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Production branch | main |
| Build command | npm run build |
| Build output directory | cloudflare-dist |
| Root directory | Leave empty when these files are at the repository root |
| Node version | 24 (also specified in .node-version) |

In the new Pages project's **Settings**:

1. **Bindings**: add a D1 database binding named `DB`; select your existing `forge-training` database.
2. **Variables and secrets**: add a **Secret** named `FORGE_PASSWORD`, containing your chosen 16–256 character password. Keep this out of GitHub.
3. **Runtime → Compatibility flags**: enable `nodejs_compat`.
4. Redeploy. When the browser asks for a username, enter `forge`; use your chosen password.

Optional: bind an R2 bucket as `BUCKET` for cloud photo backup. Other training features work without R2.

No Zero Trust setup or payment-card onboarding is needed for this login. Database tables are created automatically. Training is stored locally immediately and synchronised to your D1 database. Cloudflare still applies its normal service limits.

Every push to `main` triggers a new production build after the Git connection is configured. Reuse the same D1 database and password to retain cloud training data from the password-login deployment. The previous ChatGPT-hosted site uses a different identity; transfer that history using Forge's JSON backup and restore if needed.

Cloudflare documentation: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [direct-upload project limitations](https://developers.cloudflare.com/pages/get-started/direct-upload/), [D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases).

## Development and validation

Use Node.js 24:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run test:cloudflare
```

`npm run dev` opens the local development app on port 5173 using a synthetic local identity and local storage. It does not require a production password or production database.

To test the production password wrapper locally, create an ignored `.dev.vars` file containing your local test `FORGE_PASSWORD`, then run `npm start` after building. This uses a separate local D1 database; production secrets are never needed for local tests.

The GitHub Actions workflow runs unit tests, TypeScript validation, the production build, and password/storage integration tests. Deployment itself is handled by Cloudflare's Git connection; GitHub does not need Cloudflare API tokens.

## Data and import

**More → Data → Import Training History → Planfit** accepts `workout_sessions.csv`, `workout_exercises.csv`, `workout_sets.csv`, `exercise_daily_records.csv`, `daily_steps.csv`, and `profile.csv`. Review matching, naming suggestions, and duplicates before confirming. Generic CSV/JSON import remains available.

Completed sessions retain their own exercises, sets, names, source metadata, and ordering independently of the current programme. Bonus and imported workouts do not advance the normal rotation. JSON export/restore preserves the app data; CSV export is also available.

Only synthetic import fixtures are included in this repository. Keep actual training exports and backups outside Git. Generated output, local databases, credentials, and installed dependencies are ignored.
