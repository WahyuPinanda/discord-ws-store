#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-river-sky-416523}"
REGION="${REGION:-asia-southeast2}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-ws-store}"
SERVICE_NAME="${SERVICE_NAME:-ws-store-official-bot}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPOSITORY}/${SERVICE_NAME}:latest"

DISCORD_CLIENT_ID="${DISCORD_CLIENT_ID:-1521850563850141818}"
DISCORD_GUILD_ID="${DISCORD_GUILD_ID:-1521851161257447545}"
OWNER_DISCORD_ID="${OWNER_DISCORD_ID:-1338298916059217953}"
SUPABASE_URL="${SUPABASE_URL:-https://vrlleqkvtxmoungtulmk.supabase.co}"
RUN_SERVICE_ACCOUNT="${RUN_SERVICE_ACCOUNT:-github-cloud-run-deployer@river-sky-416523.iam.gserviceaccount.com}"

echo "Using project ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "Syncing latest code from GitHub..."
git fetch origin main
git checkout main
git pull --ff-only origin main

echo "Current commit:"
git log -1 --oneline

echo "Checking that new features exist in local source..."
grep -q "QRIS button, voice Room 1, server stats" src/index.js
grep -q "setName('open')" src/deploy-commands.js
grep -q "service_statuses" supabase/schema.sql

echo "Building and pushing ${IMAGE}..."
gcloud builds submit --tag "${IMAGE}"

echo "Deploying Cloud Run service..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --min-instances 1 \
  --max-instances 1 \
  --no-cpu-throttling \
  --no-allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --port 8080 \
  --service-account "${RUN_SERVICE_ACCOUNT}" \
  --set-env-vars "DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID},DISCORD_GUILD_ID=${DISCORD_GUILD_ID},OWNER_DISCORD_ID=${OWNER_DISCORD_ID},STORE_NAME=WS Store Official,STORE_TIMEZONE=Asia/Jakarta,STORE_TIMEZONE_LABEL=WIB,STORE_OPEN_HOUR=10,STORE_CLOSE_HOUR=22,QRIS_IMAGE_PATH=assets/qris-ws-store.png,SUPABASE_URL=${SUPABASE_URL}" \
  --set-secrets "DISCORD_TOKEN=discord-token:latest,SUPABASE_SECRET_KEY=supabase-secret-key:latest"

echo "Deploying slash commands..."
export DISCORD_TOKEN
DISCORD_TOKEN="$(gcloud secrets versions access latest --secret=discord-token)"
export SUPABASE_SECRET_KEY
SUPABASE_SECRET_KEY="$(gcloud secrets versions access latest --secret=supabase-secret-key)"
export DISCORD_CLIENT_ID
export DISCORD_GUILD_ID
export SUPABASE_URL
npm ci
npm run deploy:commands

echo "Recent logs:"
gcloud run services logs read "${SERVICE_NAME}" --region "${REGION}" --limit 20

echo "Done. Run /setup-server again in Discord after refreshing Discord."
