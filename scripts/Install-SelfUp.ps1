$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'Start-SelfUp.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'Small Wins.lnk'

if (-not (Test-Path $launcher)) { throw "Launcher not found: $launcher" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Start the offline Small Wins app and local database'
$edge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) {
  $edge = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
}
if (Test-Path $edge) { $shortcut.IconLocation = "$edge,0" }
$shortcut.Save()

Write-Host "Created $shortcutPath"
Write-Host 'Double-click Small Wins on your desktop to start the app. Use Stop-SelfUp.cmd when you want to stop it.'
Read-Host 'Press Enter to close'
