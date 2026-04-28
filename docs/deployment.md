# Deployment

## Recommended Setup

Use a separate staging server for the API. The mobile app can keep using local state when the API is unavailable, but real sync, phone auth sessions, push tokens, and shared tasks need a reachable backend.

Minimum staging server:

- Ubuntu 22.04 or 24.04
- 1 vCPU
- 1-2 GB RAM
- 20 GB disk
- Docker and Docker Compose plugin
- SSH access from GitHub Actions
- A domain for the PWA and API, currently `veratt.ru`

## Current CD Shape

The repository includes:

- `.github/workflows/ci.yml` for typechecking the Expo app and Hono server.
- `.github/workflows/deploy-server.yml` for manual SSH deployment of the API and PWA.
- `server/Dockerfile` for the Bun/Hono API.
- `deploy/docker-compose.yml` for running the API and Caddy containers.
- `deploy/Caddyfile` for serving the PWA at `/` and reverse proxying API requests from `/api/*`.
- A Docker volume named `api-data` for `/data/store.json`, the current MVP persistence file.

The deploy workflow expects these GitHub repository secrets:

- `SERVER_HOST`: `217.114.9.114`
- `SERVER_USER`: `root`
- `SERVER_SSH_KEY`: private key allowed on the server
- `SERVER_APP_DIR`: optional, defaults to `/opt/task-manager`

Legacy direct API endpoint:

```text
http://217.114.9.114:8787
```

Keep it available only until fresh mobile preview builds are installed. New web and mobile builds use the HTTPS API below.

Current production domain shape:

```text
https://veratt.ru
https://veratt.ru/api
https://veratt.ru/api/health
```

DNS must contain an A record:

```text
veratt.ru -> 217.114.9.114
www.veratt.ru -> 217.114.9.114
```

Caddy will issue and renew the Let's Encrypt certificate after DNS points to the server and ports 80/443 are reachable.

A dedicated deploy key was generated locally at `.deploy/github-actions-vtt-deploy`. The `.deploy/` directory is gitignored. Its public key is already installed in `root@217.114.9.114:~/.ssh/authorized_keys`.

Use the helper to prepare the GitHub Actions secrets:

```bash
scripts/prepare-deploy-secrets.sh
```

If GitHub CLI is installed and authenticated, the helper can set them:

```bash
scripts/prepare-deploy-secrets.sh --apply
```

## Server Bootstrap

On a fresh Ubuntu server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Then add the public SSH key used by GitHub Actions to:

```text
~/.ssh/authorized_keys
```

Create the app directory:

```bash
sudo mkdir -p /opt/task-manager
sudo chown "$USER:$USER" /opt/task-manager
```

## First Deploy

1. Push the repository to GitHub.
2. Add the GitHub Actions secrets listed above.
3. Run `Deploy Server` manually from the Actions tab.
4. Verify:

```bash
curl -fsS https://veratt.ru/api/health
```

Manual update from the local machine:

```bash
npm run web:export:prod
tar -czf /tmp/task-manager-web-dist.tar.gz -C dist .
scp -i .deploy/github-actions-vtt-deploy /tmp/task-manager-web-dist.tar.gz root@217.114.9.114:/tmp/task-manager-web-dist.tar.gz
ssh -i .deploy/github-actions-vtt-deploy root@217.114.9.114
```

Then on the server:

```bash
set -e
cd /opt/task-manager
git fetch origin main
git reset --hard origin/main
mkdir -p web
rm -rf web/*
tar -xzf /tmp/task-manager-web-dist.tar.gz -C web
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml up -d --force-recreate --no-deps caddy
curl -fsS http://127.0.0.1:8787/health
```

The current MVP uses JSON snapshot persistence at `/data/store.json` inside the API container. Docker keeps it in the `api-data` volume, so regular redeploys and container restarts do not erase data.

Staging also sets `DEV_AUTH_CODE=1234` because SMS delivery is not connected yet. Remove this env var before using real phone auth in production.

## Production Notes

Before real users:

- Replace `MemoryStore` with Postgres-backed repositories.
- Move OTP delivery to an SMS provider.
- Add persistent refresh token storage and token revocation.
- Add database backups.
- Restrict CORS to known app origins where applicable.
