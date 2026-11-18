param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

function Open-SelfUp {
  Write-Host 'Small Wins is ready at http://localhost:3000.'
  if ($NoBrowser) { return }
  $edgePaths = @(
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
  )
  $edge = $edgePaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  if ($edge) {
    Start-Process -FilePath $edge -ArgumentList '--app=http://localhost:3000'
  } else {
    Start-Process 'http://localhost:3000'
  }
}

function Start-LocalNode {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $node -or -not (Test-Path (Join-Path $root 'node_modules\express'))) {
    throw 'Install Node.js 22+ and run npm ci once while online, or install Docker Desktop for the self-contained setup.'
  }

  $databaseHost = & $node.Source -e "require('dotenv').config(); if (!process.env.DATABASE_URL) process.exit(2); process.stdout.write(new URL(process.env.DATABASE_URL).hostname)"
  if ($LASTEXITCODE -ne 0 -or $databaseHost -notin @('localhost', '127.0.0.1', '::1', '[::1]')) {
    throw 'The no-Docker setup requires DATABASE_URL in .env to point to a PostgreSQL database on this computer.'
  }

  $existing = $false
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health/live' -TimeoutSec 2
    $existing = $health.ok -eq $true
  } catch {}
  if ($existing) {
    Open-SelfUp
    return
  }

  $env:JWT_SECRET = $script:localJwtSecret
  $env:PORT = '3000'
  $env:TRUST_PROXY = '0'
  $env:APP_URL = 'http://localhost:3000'

  Write-Host 'Preparing the local PostgreSQL database.'
  & $node.Source 'scripts/migrate.js'
  if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed. Check DATABASE_URL and the local PostgreSQL service.' }

  $logDirectory = Join-Path $root 'logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $stdout = Join-Path $logDirectory 'selfup-local.out.log'
  $stderr = Join-Path $logDirectory 'selfup-local.err.log'
  $serverPath = Join-Path $root 'server.js'
  $process = Start-Process -FilePath $node.Source -ArgumentList "`"$serverPath`"" `
    -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr -PassThru
  $pidPath = Join-Path $root '.selfup-local.pid'
  Set-Content -Path $pidPath -Value $process.Id -Encoding ascii

  $ready = $false
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health/ready' -TimeoutSec 2
      if ($response.ok -eq $true) { $ready = $true; break }
    } catch {
      if ($process.HasExited) { break }
      Start-Sleep -Seconds 1
    }
  }

  if (-not $ready) {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    if (Test-Path $stderr) { Get-Content $stderr -Tail 30 | Write-Host }
    throw 'Small Wins did not become ready. Review the local log files in logs\.'
  }

  Open-SelfUp
}

try {
  $envFile = Join-Path $root '.env.local'
  $settings = @{}
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match '^([A-Z_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
    }
  }

  if (-not $settings.ContainsKey('JWT_SECRET') -or $settings['JWT_SECRET'].Length -lt 32) {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $settings['JWT_SECRET'] = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  }

  @("JWT_SECRET=$($settings['JWT_SECRET'])") | Set-Content -Path $envFile -Encoding ascii
  $script:localJwtSecret = $settings['JWT_SECRET']

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  $dockerReady = $false
  if ($docker) {
    & $docker.Source info *> $null
    $dockerReady = $LASTEXITCODE -eq 0
  }

  if (-not $dockerReady) {
    Write-Host 'Docker is unavailable; using the local Node.js and PostgreSQL installation.'
    Start-LocalNode
    return
  }

  $appImage = 'selfup-local:latest'
  $databaseImage = 'postgres:16-alpine'
  & $docker.Source image inspect $appImage *> $null
  $appImageCached = $LASTEXITCODE -eq 0
  & $docker.Source image inspect $databaseImage *> $null
  $databaseImageCached = $LASTEXITCODE -eq 0

  if ($appImageCached -and $databaseImageCached) {
    Write-Host 'Starting Small Wins from its locally cached images; internet access is not required.'
    & $docker.Source compose --env-file $envFile --profile full up -d --no-build --pull never
  } else {
    Write-Host 'First Docker setup needs internet to download the local database image and build Small Wins.'
    & $docker.Source compose --env-file $envFile --profile full up -d --build --pull missing
  }
  if ($LASTEXITCODE -ne 0) { throw 'Docker could not start Small Wins. Review the error above and try again.' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    try {
      $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health/ready' -TimeoutSec 2
      if ($response.ok -eq $true) { $ready = $true; break }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if (-not $ready) {
    & $docker.Source compose --env-file $envFile --profile full logs --tail 60
    throw 'Small Wins did not become ready. See the service logs above.'
  }

  Open-SelfUp
} catch {
  Write-Error $_.Exception.Message
  Read-Host 'Press Enter to close'
  exit 1
} finally {
  Pop-Location
}
