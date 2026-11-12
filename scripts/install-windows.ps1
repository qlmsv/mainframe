# Помощник только на этом компьютере с Windows 10/11, без сервера: работает, пока компьютер включён.
# В PowerShell (обычном, не от администратора):
#   irm https://raw.githubusercontent.com/qlmsv/mainframe/main/scripts/install-windows.ps1 | iex
# Ставит всё в %USERPROFILE%\mainframe (Node.js в той же папке), автозапуск при входе в Windows
# (Планировщик заданий), потом открывает мастер настройки: http://127.0.0.1:7777/setup
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Dir = if ($env:MAINFRAME_DIR) { $env:MAINFRAME_DIR } else { Join-Path $env:USERPROFILE 'mainframe' }
$Zip = if ($env:MAINFRAME_ZIP) { $env:MAINFRAME_ZIP } else { 'https://github.com/qlmsv/mainframe/archive/refs/heads/main.zip' }
$Port = if ($env:PORT) { $env:PORT } else { '7777' }
function Say($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Нужна Windows 10 или 11.' }
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

Say "Код помощника в $Dir"
if (-not (Test-Path (Join-Path $Dir 'src\index.js'))) {
  $z = Join-Path $env:TEMP 'mf.zip'; $t = Join-Path $env:TEMP 'mf-src'
  Invoke-WebRequest -UseBasicParsing $Zip -OutFile $z
  if (Test-Path $t) { Remove-Item -Recurse -Force $t }
  Expand-Archive -Force $z $t
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Copy-Item -Recurse -Force (Join-Path (Get-ChildItem $t | Select-Object -First 1).FullName '*') $Dir
  Remove-Item -Recurse -Force $z, $t
}
Set-Location $Dir

Say 'Node.js'
$NodeDir = Join-Path $Dir 'vendor\node'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
  $sums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
  $name = ([regex]::Match($sums, "node-v[\d.]+-win-$Arch\.zip")).Value
  $z = Join-Path $env:TEMP 'mf-node.zip'; $t = Join-Path $env:TEMP 'mf-node'
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v24.x/$name" -OutFile $z
  if (Test-Path $t) { Remove-Item -Recurse -Force $t }
  Expand-Archive -Force $z $t
  New-Item -ItemType Directory -Force -Path (Split-Path $NodeDir) | Out-Null
  Move-Item (Get-ChildItem $t | Select-Object -First 1).FullName $NodeDir
  Remove-Item -Recurse -Force $z, $t
}
$env:Path = "$NodeDir;$env:USERPROFILE\.local\bin;$env:Path"
$Node = Join-Path $NodeDir 'node.exe'
$Npm = Join-Path $NodeDir 'npm.cmd'
& $Npm ci --omit=dev --no-audit --no-fund | Out-Null
$Br = Join-Path $Dir 'vendor\browser'
New-Item -ItemType Directory -Force -Path $Br | Out-Null
if (-not (Test-Path (Join-Path $Br 'package.json'))) { '{ "private": true }' | Set-Content -Encoding ascii (Join-Path $Br 'package.json') }
Push-Location $Br; & $Npm install --no-audit --no-fund --silent chrome-devtools-mcp@1.13.0 | Out-Null; Pop-Location

Say 'Claude Code и uv'
if (-not (Test-Path (Join-Path $env:USERPROFILE '.local\bin\claude.exe'))) {
  try { powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Null } catch { Write-Host 'Claude Code не поставился: вход в Claude будет по токену.' }
}
$Uvx = Join-Path $env:USERPROFILE '.local\bin\uvx.exe'
if (-not (Test-Path $Uvx)) { powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex' | Out-Null }
if (Test-Path $Uvx) { & $Uvx --python 3.14 windows-mcp --help | Out-Null }

Say 'Настройки'
$EnvFile = Join-Path $Dir '.env'
if (-not (Test-Path $EnvFile)) { Copy-Item (Join-Path $Dir '.env.example') $EnvFile }
function Set-EnvLine($k, $v) {
  $lines = [Collections.Generic.List[string]]@(Get-Content $EnvFile -Encoding utf8)
  $i = $lines.FindIndex({ param($l) $l -match "^$k=" })
  if ($i -ge 0) { $lines[$i] = "$k=$v" } else { $lines.Add("$k=$v") }
  [IO.File]::WriteAllLines($EnvFile, $lines, (New-Object Text.UTF8Encoding $false))
}
$Code = -join ((48..57) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
Set-EnvLine 'SETUP_CODE' $Code; Set-EnvLine 'MF_MODE' 'computer'; Set-EnvLine 'HOST' '127.0.0.1'; Set-EnvLine 'PORT' $Port; Set-EnvLine 'TUNNEL' 'off'
Set-EnvLine 'UVX_PATH' ($Uvx -replace '\\', '/')
$Mcp = Join-Path $Dir 'mcp.json'
if (-not (Test-Path $Mcp)) {
  $cdt = Join-Path $Br 'node_modules\chrome-devtools-mcp\out\Default\gen\src\bin\chrome-devtools-mcp.js'
  $servers = [ordered]@{
    windows = @{ command = $Uvx; args = @('--python', '3.14', 'windows-mcp', 'serve') }
    chrome = @{ command = $Node; args = @($cdt, '--userDataDir', (Join-Path $Dir 'data\chrome-profile'), '--usageStatistics', 'false', '--performanceCrux', 'false') }
  }
  [IO.File]::WriteAllText($Mcp, (@{ mcpServers = $servers } | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))
}

Say 'Автозапуск (Планировщик заданий)'
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'data\logs') | Out-Null
$loop = Join-Path $Dir 'data\run-mainframe.ps1'
@"
`$env:Path = '$NodeDir;$env:USERPROFILE\.local\bin;' + `$env:Path
Set-Location '$Dir'
while (`$true) {
  & '$Node' --disable-warning=ExperimentalWarning 'src\index.js' *>> 'data\logs\mainframe.log'
  Start-Sleep -Seconds 5
}
"@ | Set-Content -Encoding utf8 $loop
$vbs = Join-Path $Dir 'data\hidden.vbs'
'CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False' | Set-Content -Encoding ascii $vbs
Unregister-ScheduledTask -TaskName 'mainframe' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'mainframe' -Description 'Личный помощник' `
  -Action (New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`" `"$loop`"") `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) `
  -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew) `
  -Principal (New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited) | Out-Null
Start-ScheduledTask -TaskName 'mainframe'

$url = "http://127.0.0.1:$Port/setup/?code=$Code"
for ($i = 0; $i -lt 30; $i++) { try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/setup/" | Out-Null; break } catch { Start-Sleep 2 } }
Say 'Готово. Открываю мастер настройки.'
Start-Process $url
Write-Host "Если браузер не открылся: $url"
