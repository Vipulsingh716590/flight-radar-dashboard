<#
.SYNOPSIS
  Starts the whole Flight Radar India stack locally: PostgreSQL, API and dashboard.

.DESCRIPTION
  - installs npm dependencies if node_modules is missing
  - creates backend/.env on first run (random JWT secret + admin password)
  - starts PostgreSQL via Docker if available, otherwise the embedded dev database
  - opens the API and the dashboard in their own windows and the browser
  Anything already listening on its port is left alone, so it is safe to re-run.

.EXAMPLE
  .\run-local.ps1
  .\run-local.ps1 -NoBrowser
#>
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

function Test-Port([int]$Port) {
  # Ask the OS for listeners instead of connecting: dev servers often listen on
  # ::1 only, which a plain IPv4 TcpClient cannot reach.
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$listener
}

function Wait-Port([int]$Port, [string]$Name, [int]$Seconds = 90) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return }
    Start-Sleep -Milliseconds 700
  }
  throw "$Name did not start on port $Port within $Seconds s. Check its window for errors."
}

function Start-Window([string]$Title, [string]$Directory, [string]$Command) {
  $inner = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$Directory'; $Command"
  Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $inner | Out-Null
}

function New-RandomSecret([int]$Bytes) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return ([Convert]::ToBase64String($buffer)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# --- prerequisites ---------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is not installed. Install Node 22 or newer from https://nodejs.org and run this again.'
}
Write-Host "Node $(node -v)" -ForegroundColor DarkGray

foreach ($dir in @($backend, $frontend)) {
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Write-Host "Installing dependencies in $(Split-Path -Leaf $dir) ..." -ForegroundColor Cyan
    Push-Location $dir
    try { npm install --no-audit --no-fund } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "npm install failed in $dir" }
  }
}

# --- backend/.env ----------------------------------------------------------
$envFile = Join-Path $backend '.env'
$newEnv = $false
if (-not (Test-Path $envFile)) {
  $lines = @(
    'PORT=3000',
    'FRONTEND_ORIGIN=http://localhost:4200',
    "JWT_SECRET=$(New-RandomSecret 48)",
    'ADMIN_EMAIL=admin@flightradar.local',
    "ADMIN_PASSWORD=$(New-RandomSecret 18)",
    'DATABASE_URL=postgres://flightradar:flightradar@localhost:5432/flightradar'
  )
  Set-Content -Path $envFile -Value $lines -Encoding ascii
  $newEnv = $true
  Write-Host 'Created backend\.env with a random admin password.' -ForegroundColor Yellow
}

# --- PostgreSQL ------------------------------------------------------------
if (Test-Port 5432) {
  Write-Host 'PostgreSQL: already running on :5432' -ForegroundColor Green
} else {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  $usedDocker = $false
  if ($docker) {
    Write-Host 'PostgreSQL: starting with Docker ...' -ForegroundColor Cyan
    Push-Location $root
    try { docker compose up -d postgres; $usedDocker = ($LASTEXITCODE -eq 0) } finally { Pop-Location }
  }
  if (-not $usedDocker) {
    Write-Host 'PostgreSQL: starting the embedded dev database (no Docker) ...' -ForegroundColor Cyan
    Start-Window 'Flight Radar - PostgreSQL' $backend 'npm run db:dev'
  }
  Wait-Port 5432 'PostgreSQL' 120
  Write-Host 'PostgreSQL: up' -ForegroundColor Green
}

# --- API -------------------------------------------------------------------
if (Test-Port 3000) {
  Write-Host 'API: already running on :3000' -ForegroundColor Green
} else {
  Write-Host 'API: starting ...' -ForegroundColor Cyan
  Start-Window 'Flight Radar - API' $backend 'npm run start:dev'
  Wait-Port 3000 'API' 120
  Write-Host 'API: up' -ForegroundColor Green
}

# --- dashboard -------------------------------------------------------------
if (Test-Port 4200) {
  Write-Host 'Dashboard: already running on :4200' -ForegroundColor Green
} else {
  Write-Host 'Dashboard: starting ...' -ForegroundColor Cyan
  Start-Window 'Flight Radar - Dashboard' $frontend 'npm start'
  Wait-Port 4200 'Dashboard' 180
  Write-Host 'Dashboard: up' -ForegroundColor Green
}

# --- done ------------------------------------------------------------------
$adminEmail = ((Get-Content $envFile) | Where-Object { $_ -like 'ADMIN_EMAIL=*' } | Select-Object -First 1) -replace '^ADMIN_EMAIL=', ''
Write-Host ''
Write-Host 'Flight Radar India is running' -ForegroundColor Green
Write-Host '  Dashboard : http://localhost:4200'
Write-Host '  API       : http://localhost:3000/api/health'
Write-Host "  Login     : $adminEmail"
Write-Host '  Password  : ADMIN_PASSWORD in backend\.env'
Write-Host '  Stop all  : .\stop-local.ps1'
if ($newEnv) { Write-Host '  (first run: live data appears after about 40 seconds)' -ForegroundColor DarkGray }

if (-not $NoBrowser) { Start-Process 'http://localhost:4200' | Out-Null }
