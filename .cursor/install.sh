#!/usr/bin/env bash
# Idempotent Cloud Agent install for Musashi.
# - installs pinned dependencies via the repo's package manager
# - seeds a dev .env.local (offline / mock mode, no external API keys) when absent
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[musashi-install] Installing dependencies with pnpm..."
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

if [ ! -f .env.local ]; then
  echo "[musashi-install] Seeding dev .env.local (offline / mock mode)..."
  cat > .env.local <<'ENV'
# Auto-generated for Cloud Agent dev — offline / zero-spend, no external keys required.
NODE_ENV=development

# Skip login for local dev (never in production)
MUSASHI_DISABLE_AUTH=1

# In-memory mock DB with seeded marketplace data (no wrangler/D1 needed)
MUSASHI_USE_MOCK_DB=1

# Mock storage (local .uploads/ folder) and mock marketplace payments
MUSASHI_STORAGE_MODE=mock
MUSASHI_MARKETPLACE_PAYMENTS=mock

# Offline / zero-spend mode: no paid API calls (Gemini/fal.ai return mocks)
OFFLINE_MODE=1
GEMINI_DRY_RUN=1
FAL_DRY_RUN=1
NEXT_PUBLIC_OFFLINE_MODE=1

# Dry-run email (logs instead of sending)
EMAIL_DRY_RUN=1

# Session secret (dev-only placeholder, min 32 chars)
MUSASHI_SESSION_SECRET=dev-local-session-secret-please-change-in-production-0123456789

# Enable preview feature nav/content for a fuller demo
NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES=1
ENV
else
  echo "[musashi-install] .env.local already present — leaving it untouched."
fi

echo "[musashi-install] Done."
