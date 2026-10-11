<#
.SYNOPSIS
  Stops what run-local.ps1 started: dashboard (4200), API (3000) and the dev PostgreSQL (5432).
  Data in the database is kept. A Docker PostgreSQL is stopped with `docker compose stop`.
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($entry in @(@(4200, 'Dashboard'), @(3000, 'API'), @(5432, 'PostgreSQL'))) {
  $port = $entry[0]; $name = $entry[1]
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $listeners) { Write-Host "$name (:$port): not running"; continue }
  foreach ($procId in ($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
    $process = Get-Process -Id $procId -ErrorAction SilentlyContinue
    # A PostgreSQL started by Docker belongs to Docker's backend; do not kill that.
    if ($port -eq 5432 -and $process -and $process.ProcessName -match 'docker|wslrelay|vpnkit') {
      Write-Host "PostgreSQL (:5432): owned by Docker, use: docker compose stop"
      continue
    }
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "$name (:$port): stopped (pid $procId)"
  }
}
