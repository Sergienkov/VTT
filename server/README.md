# Task Manager API

TypeScript + Hono backend intended to run on Bun.

## Run

```bash
bun run server:dev
```

The API listens on `http://localhost:8787` by default. Set `PORT` to override.

From the repository root:

```bash
npm run server:start
npm run server:smoke
```

## Development Auth

In non-production mode, phone login returns `devCode` in the response from:

```http
POST /auth/phone/start
```

The seeded test user is:

```text
+79990000000
```

For staging without SMS delivery, set:

```bash
DEV_AUTH_CODE=1234
```

## Implemented MVP Surface

- `POST /auth/phone/start`
- `POST /auth/phone/verify`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `PATCH /me`
- `GET /tasks`
- `POST /tasks`
- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`
- `POST /tasks/:id/complete`
- `POST /tasks/:id/reopen`
- `POST /tasks/:id/seen`
- `GET /tasks/:id/comments`
- `POST /tasks/:id/comments`
- `PATCH /comments/:id`
- `DELETE /comments/:id`
- `GET /ideas`
- `POST /ideas`
- `GET /ideas/:id`
- `PATCH /ideas/:id`
- `DELETE /ideas/:id`
- `POST /ideas/:id/convert`
- `GET /links`
- `POST /links/invite`
- `POST /links/accept`
- `GET /events`
- `POST /events/:id/read`
- `POST /device-tokens`
- `DELETE /device-tokens/:id`
- `GET /sync`
- `POST /sync/push`

State is kept in memory by default. Set `DATA_FILE` to persist snapshots:

```bash
DATA_FILE=/data/store.json bun src/index.ts
```

The Docker Compose setup already mounts `/data` as a named volume. The next backend step is replacing `MemoryStore` with Postgres-backed repositories that preserve the same route contract.

## Docker

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```
