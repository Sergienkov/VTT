#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-Sergienkov/VTT}"
SERVER_HOST="${SERVER_HOST:-217.114.9.114}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_APP_DIR="${SERVER_APP_DIR:-/opt/task-manager}"
KEY_PATH="${KEY_PATH:-.deploy/github-actions-vtt-deploy}"

if [[ ! -f "$KEY_PATH" ]]; then
  echo "Missing deploy private key: $KEY_PATH" >&2
  exit 1
fi

cat <<EOF
GitHub repository: $REPO

Add these GitHub Actions secrets:

SERVER_HOST=$SERVER_HOST
SERVER_USER=$SERVER_USER
SERVER_APP_DIR=$SERVER_APP_DIR
SERVER_SSH_KEY=<contents of $KEY_PATH>

Copy SERVER_SSH_KEY on macOS:
  pbcopy < "$KEY_PATH"

Copy SERVER_SSH_KEY on Linux:
  xclip -selection clipboard < "$KEY_PATH"

Manual GitHub UI:
  https://github.com/$REPO/settings/secrets/actions
EOF

if [[ "${1:-}" == "--apply" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI is not installed. Install gh or add secrets in the GitHub UI." >&2
    exit 1
  fi

  gh secret set SERVER_HOST --repo "$REPO" --body "$SERVER_HOST"
  gh secret set SERVER_USER --repo "$REPO" --body "$SERVER_USER"
  gh secret set SERVER_APP_DIR --repo "$REPO" --body "$SERVER_APP_DIR"
  gh secret set SERVER_SSH_KEY --repo "$REPO" < "$KEY_PATH"
  echo "GitHub Actions secrets updated."
fi
