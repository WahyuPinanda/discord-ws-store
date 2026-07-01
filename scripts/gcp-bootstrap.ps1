param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectId,

  [Parameter(Mandatory = $true)]
  [string]$ProjectNumber,

  [Parameter(Mandatory = $true)]
  [string]$GitHubOwner,

  [Parameter(Mandatory = $true)]
  [string]$GitHubRepo,

  [string]$Region = "asia-southeast2",
  [string]$ServiceName = "ws-store-official-bot",
  [string]$ArtifactRepository = "ws-store",
  [string]$PoolId = "github-actions-pool",
  [string]$ProviderId = "github-actions-provider",
  [string]$DeployServiceAccount = "github-cloud-run-deployer"
)

$ErrorActionPreference = "Stop"

Write-Host "Setting active project: $ProjectId"
gcloud config set project $ProjectId

Write-Host "Enabling required Google Cloud APIs..."
gcloud services enable `
  run.googleapis.com `
  artifactregistry.googleapis.com `
  iam.googleapis.com `
  iamcredentials.googleapis.com `
  secretmanager.googleapis.com `
  cloudbuild.googleapis.com

Write-Host "Creating Artifact Registry repository if missing..."
$repoExists = gcloud artifacts repositories describe $ArtifactRepository --location=$Region 2>$null
if (-not $repoExists) {
  gcloud artifacts repositories create $ArtifactRepository `
    --repository-format=docker `
    --location=$Region `
    --description="WS Store Docker images"
}

Write-Host "Creating deploy service account if missing..."
$deploySaEmail = "$DeployServiceAccount@$ProjectId.iam.gserviceaccount.com"
$deploySaExists = gcloud iam service-accounts describe $deploySaEmail 2>$null
if (-not $deploySaExists) {
  gcloud iam service-accounts create $DeployServiceAccount `
    --display-name="GitHub Cloud Run deployer"
}

Write-Host "Granting deploy permissions..."
$roles = @(
  "roles/run.admin",
  "roles/artifactregistry.writer",
  "roles/iam.serviceAccountUser",
  "roles/secretmanager.secretAccessor"
)

foreach ($role in $roles) {
  gcloud projects add-iam-policy-binding $ProjectId `
    --member="serviceAccount:$deploySaEmail" `
    --role=$role `
    --condition=None
}

Write-Host "Creating Secret Manager secrets if missing..."
$secretNames = @("discord-token", "supabase-secret-key")
foreach ($secretName in $secretNames) {
  $secretExists = gcloud secrets describe $secretName 2>$null
  if (-not $secretExists) {
    gcloud secrets create $secretName --replication-policy=automatic
    Write-Host "Created secret: $secretName"
    Write-Host "Add value with: gcloud secrets versions add $secretName --data-file=PATH_TO_SECRET_TXT"
  }
}

Write-Host "Creating Workload Identity Pool if missing..."
$poolExists = gcloud iam workload-identity-pools describe $PoolId --location=global 2>$null
if (-not $poolExists) {
  gcloud iam workload-identity-pools create $PoolId `
    --location=global `
    --display-name="GitHub Actions Pool"
}

Write-Host "Creating Workload Identity Provider if missing..."
$providerExists = gcloud iam workload-identity-pools providers describe $ProviderId `
  --workload-identity-pool=$PoolId `
  --location=global 2>$null

if (-not $providerExists) {
  gcloud iam workload-identity-pools providers create-oidc $ProviderId `
    --workload-identity-pool=$PoolId `
    --location=global `
    --display-name="GitHub Actions Provider" `
    --issuer-uri="https://token.actions.githubusercontent.com" `
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" `
    --attribute-condition="assertion.repository == '$GitHubOwner/$GitHubRepo'"
}

$principal = "principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId/attribute.repository/$GitHubOwner/$GitHubRepo"

Write-Host "Allowing GitHub repo to impersonate deploy service account..."
gcloud iam service-accounts add-iam-policy-binding $deploySaEmail `
  --role="roles/iam.workloadIdentityUser" `
  --member=$principal

$providerName = "projects/$ProjectNumber/locations/global/workloadIdentityPools/$PoolId/providers/$ProviderId"

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Add these GitHub repository variables:"
Write-Host "GCP_PROJECT_ID=$ProjectId"
Write-Host "GCP_REGION=$Region"
Write-Host "CLOUD_RUN_SERVICE=$ServiceName"
Write-Host "ARTIFACT_REPOSITORY=$ArtifactRepository"
Write-Host "GCP_WORKLOAD_IDENTITY_PROVIDER=$providerName"
Write-Host "GCP_DEPLOY_SERVICE_ACCOUNT=$deploySaEmail"
Write-Host "DISCORD_CLIENT_ID=<your Discord application client id>"
Write-Host "DISCORD_GUILD_ID=<your Discord server id>"
Write-Host "OWNER_DISCORD_ID=<your Discord owner id>"
Write-Host "SUPABASE_URL=<your Supabase project URL>"
