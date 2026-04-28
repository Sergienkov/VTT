# Task Manager Expo

Expo + React Native prototype for the task manager app.

## What Is Built

- Expo TypeScript project scaffold.
- Main mobile UI based on the clickable Figma prototype, not the older Page 3 exports.
- Mock screens for:
  - `День`
  - `Все задачи`
  - `Связи`
  - `Идеи`
  - timeline view
  - task detail view
- Local offline-first state through AsyncStorage repository adapter.
- MVP backend/API contract in `docs/api-contract.md`.
- Bun + Hono backend skeleton in `server/`.
- Local Figma references in `design-reference/prototype/`.

## Run

The project installs Node `22.22.2` as a dev dependency and the npm scripts run Expo through that local Node binary. This keeps Expo independent from the system Node version.

```bash
npm run typecheck
npm run web
```

Then open:

```text
http://localhost:8081
```

In restricted automation sandboxes, Expo needs permission to listen on a local TCP port. In a normal local terminal, `npm run web` is enough.

## PWA Web Preview

Use Expo Web for fast browser testing and the exported PWA build for install/offline checks.

```bash
npm run web
```

Dev server:

```text
http://localhost:8081
```

PWA export and local preview:

```bash
npm run web:export
npm run web:preview
```

Preview server:

```text
http://localhost:8082
```

The PWA shell includes a web manifest, install icons, and a service worker for the exported build. The service worker is disabled on Expo's `localhost:8081` dev server to avoid stale development bundles.

For public HTTPS hosting, the API also needs HTTPS. Browsers block calls from an HTTPS PWA to the current HTTP staging API.

The app reads the API URL from:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787
```

Use `.env.example` as the template. On a physical iOS/Android device, replace `localhost` with the LAN address of the machine running Bun.

## Backend

The backend is TypeScript + Hono for Bun. It currently uses in-memory state while keeping the route contract close to `docs/api-contract.md`.
In Docker it persists MVP data to `/data/store.json` through the `api-data` volume.

```bash
npm run server:typecheck
bun run server:dev
```

Default API URL:

```text
http://localhost:8787
```

Current staging API:

```text
http://217.114.9.114:8787
```

Development phone auth returns `devCode` from `POST /auth/phone/start`.

The Expo app stores auth in AsyncStorage and falls back to local data when the API is unavailable. The login screen also has a local-only development path.

## CI/CD

- CI: `.github/workflows/ci.yml`
- Manual server deploy: `.github/workflows/deploy-server.yml`
- EAS preview builds: `eas.json`
- Deployment notes: `docs/deployment.md`
- Docker Compose: `deploy/docker-compose.yml`

The deploy workflow expects SSH secrets in GitHub Actions and runs the Bun/Hono API on a separate server.

## Mobile Preview Builds

Preview builds use the current staging API:

```text
http://217.114.9.114:8787
```

Build Android APK:

```bash
npm run build:android:preview
```

Build iOS internal preview:

```bash
npm run build:ios:preview
```

EAS needs an Expo account and project initialization on the first run. The current native config allows cleartext HTTP for the staging IP. Before production, put the API behind HTTPS and remove the broad cleartext allowance from `app.json`.

## Project Notes

- MVP scope: `docs/mvp-scope.md`
- API contract: `docs/api-contract.md`
- Deployment: `docs/deployment.md`
- API client: `src/apiClient.ts`
- Auth storage: `src/authRepository.ts`
- Domain model: `src/domain.ts`
- Local storage adapter: `src/localTaskRepository.ts`
- Seed data: `src/seedData.ts`
- Backend app: `server/src/app.ts`
- Backend in-memory store: `server/src/store.ts`

## Figma References

The app references were exported from the prototype start node `274:15604`.

- Manifest: `design-reference/prototype/manifest.tsv`
- Graph script: `scripts/figma-prototype-graph.mjs`
