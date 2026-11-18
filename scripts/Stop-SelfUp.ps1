$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  $envFile = Join-Path $root '.env.local'
  $pidPath = Join-Path $root '.selfup-local.pid'
  if (Test-Path $pidPath) {
    $serverPid = [int](Get-Content $pidPath -Raw).Trim()
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    $serverPath = Join-Path $root 'server.js'
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($serverPath)) {
      Stop-Process -Id $serverPid
      Wait-Process -Id $serverPid -Timeout 15 -ErrorAction SilentlyContinue
      Write-Host 'Small Wins stopped. Your data remains in the local PostgreSQL database.'
    } else {
      Write-Host 'The recorded Small Wins server is not running; leaving unrelated processes untouched.'
    }
    Remove-Item -LiteralPath $pidPath -Force
    exit 0
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker -or -not (Test-Path $envFile)) {
    Write-Host 'Small Wins is not running; nothing to stop.'
    exit 0
  }

  & $docker.Source compose --env-file $envFile --profile full down
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop Small Wins. Check that Docker Desktop is running.' }
  Write-Host 'Small Wins stopped. Your data remains saved in the Docker volume.'
} catch {
  Write-Error $_.Exception.Message
  Read-Host 'Press Enter to close'
  exit 1
} finally {
  Pop-Location
}
