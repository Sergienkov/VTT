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
- A domain or subdomain for the API, for example `api.task-manager.example`

## Current CD Shape

The repository includes:

- `.github/workflows/ci.yml` for typechecking the Expo app and Hono server.
- `.github/workflows/deploy-server.yml` for manual SSH deployment.
- `server/Dockerfile` for the Bun/Hono API.
- `deploy/docker-compose.yml` for running the API container.
- A Docker volume named `api-data` for `/data/store.json`, the current MVP persistence file.

The deploy workflow expects these GitHub repository secrets:

- `SERVER_HOST`: `217.114.9.114`
- `SERVER_USER`: `root`
- `SERVER_SSH_KEY`: private key allowed on the server
- `SERVER_APP_DIR`: optional, defaults to `/opt/task-manager`

Current staging server:

```text
http://217.114.9.114:8787
```

A dedicated deploy key was generated locally at `.deploy/github-actions-vtt-deploy`. The `.deploy/` directory is gitignored. Its public key is already installed in `root@217.114.9.114:~/.ssh/authorized_keys`.

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
curl -fsS http://SERVER_HOST:8787/health
```

Manual update on the current server:

```bash
ssh root@217.114.9.114
cd /opt/task-manager
git fetch origin main
git reset --hard origin/main
docker compose -f deploy/docker-compose.yml up -d --build
curl -fsS http://127.0.0.1:8787/health
```

The current MVP uses JSON snapshot persistence at `/data/store.json` inside the API container. Docker keeps it in the `api-data` volume, so regular redeploys and container restarts do not erase data.

Staging also sets `DEV_AUTH_CODE=1234` because SMS delivery is not connected yet. Remove this env var before using real phone auth in production.

## Production Notes

Before real users:

- Put the API behind HTTPS with Nginx or Caddy.
- Replace `MemoryStore` with Postgres-backed repositories.
- Move OTP delivery to an SMS provider.
- Add persistent refresh token storage and token revocation.
- Add database backups.
- Restrict CORS to known app origins where applicable.
