# Phase 1 infrastructure preflight — Musashi production launch
# Usage: .\scripts\phase1-setup.ps1
# Does NOT set secrets or login; reports status and prints next commands.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "`n=== Musashi Phase 1 Preflight ===" -ForegroundColor Cyan
Write-Host "Project: $Root`n"

function Test-Command($name) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    return [bool]$cmd
}

# Node / pnpm
$nodeOk = Test-Command node
$pnpmOk = Test-Command pnpm
Write-Host "[Tools]"
Write-Host "  node:   $(if ($nodeOk) { (node -v) } else { 'MISSING' })"
Write-Host "  pnpm:   $(if ($pnpmOk) { (pnpm -v) } else { 'MISSING' })"

# Wrangler (global vs local)
$wranglerGlobal = Test-Command wrangler
$wranglerLocal = $false
$wranglerVersion = $null
if ($pnpmOk) {
    try {
        $wranglerVersion = pnpm exec wrangler --version 2>&1 | Select-Object -First 1
        $wranglerLocal = $true
    } catch {}
}
Write-Host "  wrangler (global): $(if ($wranglerGlobal) { 'yes' } else { 'no — use pnpm exec wrangler' })"
Write-Host "  wrangler (local):  $(if ($wranglerLocal) { $wranglerVersion } else { 'MISSING — run pnpm install' })"

# Wrangler auth
if ($wranglerLocal) {
    Write-Host "`n[Wrangler auth]"
    $whoami = pnpm exec wrangler whoami 2>&1
    if ($whoami -match "not authenticated") {
        Write-Host "  Status: NOT LOGGED IN" -ForegroundColor Yellow
        Write-Host "  Run:    pnpm exec wrangler login"
    } else {
        Write-Host "  Status: logged in"
        Write-Host $whoami
    }
}

# WSL
Write-Host "`n[WSL]"
try {
    $wslStatus = wsl --status 2>&1
    if ($LASTEXITCODE -ne 0 -or $wslStatus -match "not installed") {
        Write-Host "  Status: NOT INSTALLED" -ForegroundColor Yellow
        Write-Host "  Install: wsl --install   (reboot required)"
    } else {
        Write-Host "  Status: available"
        wsl -l -v 2>&1
    }
} catch {
    Write-Host "  Status: NOT INSTALLED" -ForegroundColor Yellow
}

# Developer Mode (symlink fix on Windows)
Write-Host "`n[Windows Developer Mode]"
try {
    $devMode = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" -Name AllowDevelopmentWithoutDevLicense -ErrorAction Stop
    $enabled = $devMode.AllowDevelopmentWithoutDevLicense -eq 1
    Write-Host "  Symlink creation: $(if ($enabled) { 'allowed (Developer Mode ON)' } else { 'BLOCKED — enable Developer Mode or use WSL/CI' })" -ForegroundColor $(if ($enabled) { 'Green' } else { 'Yellow' })
} catch {
    Write-Host "  Symlink creation: BLOCKED (Developer Mode off or unavailable)" -ForegroundColor Yellow
}

# Launch strict check (keys only, skip tests for speed)
Write-Host "`n[Launch checklist]"
if ($nodeOk) {
    node scripts/marketplace-plug-in-check.mjs --strict --skip-tests 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Strict check: BLOCKERS (expected until production secrets are set locally or in Cloudflare)" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Next steps (manual) ===" -ForegroundColor Cyan
Write-Host @"

1. Login + migrate D1:
   pnpm exec wrangler login
   pnpm db:migrate:remote

2. Set secrets (see docs/PHASE1_INFRASTRUCTURE.md for full list):
   pnpm exec wrangler secret put GEMINI_API_KEY
   pnpm exec wrangler secret put MUSASHI_SESSION_SECRET
   ... (all keys in docs/PHASE1_INFRASTRUCTURE.md)

3. R2 bucket:
   pnpm exec wrangler r2 bucket create musashi-uploads

4. Fix build path (pick one):
   - Enable Windows Developer Mode, then: pnpm deploy
   - OR: wsl --install, reboot, deploy from WSL (see docs/PHASE1_INFRASTRUCTURE.md)
   - OR: GitHub Actions on ubuntu-latest

5. Custom domain + MUSASHI_APP_URL (dashboard or wrangler routes)

Full runbook: docs/PHASE1_INFRASTRUCTURE.md

"@
