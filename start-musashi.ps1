# start-musashi.ps1
# Right-click -> "Run with PowerShell" to launch the Musashi dev server
# on http://localhost:3000. Leave the window open while you use the app.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Musashi dev server" -ForegroundColor Cyan
Write-Host " Folder:  $root"
Write-Host " URL:     http://localhost:3000"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tip: if you see 'EADDRINUSE :3000', another process is using"
Write-Host "     port 3000. Close it, or run 'pnpm dev:alt' to use 3001."
Write-Host ""

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[error] pnpm is not on your PATH." -ForegroundColor Red
    Write-Host "        Install with: npm install -g pnpm@10"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Running startup checks..." -ForegroundColor DarkGray
node scripts/check-dev-ready.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[error] Startup checks failed. Fix the issues above, then retry." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit $LASTEXITCODE
}

pnpm dev

Write-Host ""
Write-Host "(Dev server has exited. Press Enter to close this window.)"
Read-Host
