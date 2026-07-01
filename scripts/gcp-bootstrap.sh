#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-river-sky-416523}"
PROJECT_NUMBER="${PROJECT_NUMBER:-}"
GITHUB_OWNER="${GITHUB_OWNER:-WahyuPinanda}"
GITHUB_REPO="${GITHUB_REPO:-discord-ws-store}"
REGION="${REGION:-asia-southeast2}"
SERVICE_NAME="${SERVICE_NAME:-ws-store-official-bot}"
ARTIFACT_REPOSITORY="${ARTIFACT_REPOSITORY:-ws-store}"
POOL_ID="${POOL_ID:-github-actions-pool}"
PROVIDER_ID="${PROVIDER_ID:-github-actions-provider}"
DEPLOY_SERVICE_ACCOUNT="${DEPLOY_SERVICE_ACCOUNT:-github-cloud-run-deployer}"

if [[ -z "$PROJECT_NUMBER" ]]; then
  PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
fi

echo "Using project: $PROJECT_ID ($PROJECT_NUMBER)"
gcloud config set project "$PROJECT_ID"

echo "Enabling required Google Cloud APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com

echo "Creating Artifact Registry repository if missing..."
if ! gcloud artifacts repositories describe "$ARTIFACT_REPOSITORY" --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$ARTIFACT_REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="WS Store Docker images"
fi

DEPLOY_SA_EMAIL="$DEPLOY_SERVICE_ACCOUNT@$PROJECT_ID.iam.gserviceaccount.com"

echo "Creating deploy service account if missing..."
if ! gcloud iam service-accounts describe "$DEPLOY_SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$DEPLOY_SERVICE_ACCOUNT" \
    --display-name="GitHub Cloud Run deployer"
fi

echo "Granting deploy permissions..."
for role in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor
do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$DEPLOY_SA_EMAIL" \
    --role="$role" \
    --condition=None >/dev/null
done

echo "Creating Secret Manager secrets if missing..."
for secret_name in discord-token supabase-secret-key; do
  if ! gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    gcloud secrets create "$secret_name" --replication-policy=automatic
    echo "Created secret: $secret_name"
  fi
done

echo "Creating Workload Identity Pool if missing..."
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --location=global \
    --display-name="GitHub Actions Pool"
fi

echo "Creating Workload Identity Provider if missing..."
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --workload-identity-pool="$POOL_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --workload-identity-pool="$POOL_ID" \
    --location=global \
    --display-name="GitHub Actions Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '$GITHUB_OWNER/$GITHUB_REPO'"
fi

PRINCIPAL="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/$GITHUB_OWNER/$GITHUB_REPO"

echo "Allowing GitHub repo to impersonate deploy service account..."
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$PRINCIPAL" >/dev/null

PROVIDER_NAME="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/providers/$PROVIDER_ID"

cat <<EOF

Bootstrap complete.

Add these GitHub repository variables:

GCP_PROJECT_ID=$PROJECT_ID
GCP_REGION=$REGION
CLOUD_RUN_SERVICE=$SERVICE_NAME
ARTIFACT_REPOSITORY=$ARTIFACT_REPOSITORY
GCP_WORKLOAD_IDENTITY_PROVIDER=$PROVIDER_NAME
GCP_DEPLOY_SERVICE_ACCOUNT=$DEPLOY_SA_EMAIL
DISCORD_CLIENT_ID=<your Discord application client id>
DISCORD_GUILD_ID=<your Discord server id>
OWNER_DISCORD_ID=<your Discord owner id>
SUPABASE_URL=<your Supabase project URL>

Then add secret values with:

printf 'YOUR_DISCORD_TOKEN' | gcloud secrets versions add discord-token --data-file=-
printf 'YOUR_SUPABASE_SECRET_KEY' | gcloud secrets versions add supabase-secret-key --data-file=-
EOF
