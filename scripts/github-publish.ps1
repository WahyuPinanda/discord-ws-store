param(
  [string]$RepoName = "ws-store-official-bot",
  [string]$Description = "Full custom Discord bot untuk WS Store Official",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI tidak ditemukan. Install GitHub CLI atau publish manual lewat github.com/new."
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M main
}

git add .
git commit -m "Initial WS Store Discord bot with Cloud Run CI/CD"

$visibility = if ($Private) { "--private" } else { "--public" }
gh repo create $RepoName $visibility --description $Description --source=. --remote=origin --push

Write-Host "Repository created and pushed."
