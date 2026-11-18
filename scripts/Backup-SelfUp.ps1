param([switch]$NoPause)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
$containerPath = $null

try {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  $dockerReady = $false
  if ($docker) {
    & $docker.Source info *> $null
    $dockerReady = $LASTEXITCODE -eq 0
  }

  $backupDirectory = Join-Path $root 'backups'
  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  $fileName = "selfup-local-$(Get-Date -Format 'yyyyMMdd-HHmmss').dump"
  $backupPath = Join-Path $backupDirectory $fileName

  if ($dockerReady) {
    $running = & $docker.Source inspect --format '{{.State.Running}}' selfup-db 2>$null
    if ($LASTEXITCODE -ne 0 -or $running -ne 'true') {
      throw 'The local Small Wins Docker database is not running. Start Small Wins, then try again.'
    }

    $containerPath = "/tmp/$fileName"
    & $docker.Source exec selfup-db pg_dump --username postgres --dbname selfup --format custom "--file=$containerPath"
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL could not create the backup.' }

    & $docker.Source cp "selfup-db:$containerPath" $backupPath
    if ($LASTEXITCODE -ne 0) {
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      throw 'The backup could not be copied to the project backups folder.'
    }
  } else {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Install Docker Desktop or Node.js to create a local database backup.' }

    $databaseHost = & $node.Source -e "require('dotenv').config(); if (!process.env.DATABASE_URL) process.exit(2); process.stdout.write(new URL(process.env.DATABASE_URL).hostname)"
    if ($LASTEXITCODE -ne 0 -or $databaseHost -notin @('localhost', '127.0.0.1', '::1', '[::1]')) {
      throw 'Native backups are restricted to a PostgreSQL database on this computer.'
    }

    $pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
    if (-not $pgDump) {
      $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL' -Filter pg_dump.exe -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    }
    if (-not $pgDump) { throw 'pg_dump was not found. Install PostgreSQL command-line tools or use Docker Desktop.' }

    $configJson = & $node.Source -e @"
require('dotenv').config();
const url = new URL(process.env.DATABASE_URL);
process.stdout.write(JSON.stringify({
  host: url.hostname,
  port: url.port || '5432',
  database: decodeURIComponent(url.pathname.slice(1)),
  username: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password)
}));
"@
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the local PostgreSQL connection settings.' }
    $database = $configJson | ConvertFrom-Json
    $env:PGPASSWORD = $database.password
    & $pgDump.Source --host $database.host --port $database.port --username $database.username `
      --dbname $database.database --format custom "--file=$backupPath"
    $exitCode = $LASTEXITCODE
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    if ($exitCode -ne 0) {
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
      throw 'pg_dump failed. Check the local database settings and PostgreSQL command-line tools.'
    }
  }

  Write-Host "Backup saved: $backupPath"
  Write-Host 'Keep a second copy on a separate drive. This database backup is not encrypted.'
  if (-not $NoPause) { Read-Host 'Press Enter to close' }
} catch {
  Write-Error $_.Exception.Message
  if (-not $NoPause) { Read-Host 'Press Enter to close' }
  exit 1
} finally {
  if ($containerPath -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    & docker exec selfup-db rm -f $containerPath 2>$null | Out-Null
  }
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
