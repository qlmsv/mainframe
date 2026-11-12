# Мост Windows → сервер помощника (Windows 10 1809+ или Windows 11).
# Команду с одноразовым кодом даёт пульт: Ещё → Система → Компьютер. В PowerShell (обычном, не от администратора):
#   irm https://<сервер>/bridge/<код>/windows.ps1 | iex
# Что даёт серверу (всё через один SSH-туннель, который открывает сам компьютер, снаружи ничего не слушает):
#   управление Windows (Windows-MCP: клики, ввод, окна, скриншоты), браузер (твой Chrome с отдельным
#   профилем), голосовые (whisper.cpp, по желанию). Почта и календарь на Windows: подключи их в пульте
#   (Почта и Google), они работают на сервере.
# Пароль от сервера не нужен: компьютер отправляет свой ключ вместе с кодом, сервер пускает этот ключ
# только на порты моста. Службы запускаются сами при входе в Windows (Планировщик заданий).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$MfUrl = if ($env:MF_URL) { $env:MF_URL } else { '__MF_URL__' }
$MfToken = if ($env:MF_TOKEN) { $env:MF_TOKEN } else { '__MF_TOKEN__' }
$M = if ($env:MF_BRIDGE_DIR) { $env:MF_BRIDGE_DIR } else { Join-Path $env:LOCALAPPDATA 'mainframe-bridge' }
$Prefix = if ($env:MF_LABEL) { $env:MF_LABEL } else { 'mainframe-bridge' }
$Shift = if ($env:MF_PORT_SHIFT) { [int]$env:MF_PORT_SHIFT } else { 0 }
$Ports = @{ computer = 8802 + $Shift; chrome = 8803 + $Shift; whisper = 8178 + $Shift; debug = 9222 + $Shift }

function Say($t) { Write-Host "`n> $t" -ForegroundColor Cyan }
function Ask($q, $def) { $v = Read-Host "$q [$def]"; if ([string]::IsNullOrWhiteSpace($v)) { $def } else { $v.Trim() } }

if ($MfToken -like '__*' -or -not $MfToken) { throw 'Нет кода подключения. Возьми команду в пульте: Ещё → Система → Компьютер.' }
if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Нужна Windows 10 или 11.' }
$Ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$Keygen = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
if (-not (Test-Path $Ssh)) {
  throw 'Нет встроенного OpenSSH. Параметры → Система → Дополнительные компоненты → Добавить → «Клиент OpenSSH», потом запусти команду ещё раз.'
}
New-Item -ItemType Directory -Force -Path $M, (Join-Path $M 'logs') | Out-Null
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

Say 'Node.js (в папке моста, без прав администратора)'
$NodeDir = Join-Path $M 'node'
if (-not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
  $sums = (Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').Content
  $zipName = ([regex]::Match($sums, "node-v[\d.]+-win-$Arch\.zip")).Value
  if (-not $zipName) { throw 'Не нашёл Node.js для этой Windows.' }
  $zip = Join-Path $env:TEMP 'mf-node.zip'
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v24.x/$zipName" -OutFile $zip
  Expand-Archive -Force $zip (Join-Path $M 'node-tmp')
  Move-Item (Get-ChildItem (Join-Path $M 'node-tmp') | Select-Object -First 1).FullName $NodeDir
  Remove-Item -Recurse -Force (Join-Path $M 'node-tmp'), $zip
}
$env:Path = "$NodeDir;$env:Path"
$Node = Join-Path $NodeDir 'node.exe'
$Npm = Join-Path $NodeDir 'npm.cmd'

Say 'Компоненты моста'
Push-Location $M
if (-not (Test-Path 'package.json')) { '{ "private": true }' | Set-Content -Encoding ascii 'package.json' }
& $Npm install --no-audit --no-fund --silent supergateway@4.2.2 chrome-devtools-mcp@1.13.0 | Out-Null
Pop-Location
$Sg = Join-Path $M 'node_modules\supergateway\dist\index.js'
$Cdt = Join-Path $M 'node_modules\chrome-devtools-mcp\out\Default\gen\src\bin\chrome-devtools-mcp.js'

Say 'Управление Windows (Windows-MCP)'
$Uv = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
if (-not (Test-Path $Uv)) { powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://astral.sh/uv/install.ps1 | iex' | Out-Null }
$Uvx = Join-Path $env:USERPROFILE '.local\bin\uvx.exe'
if (-not (Test-Path $Uvx)) { throw 'Не поставился uv (нужен для Windows-MCP).' }
# The first start downloads Python 3.14 and the package: do it now, not inside the service.
& $Uvx --python 3.14 windows-mcp --help | Out-Null

$Feat = @{ computer = $true; chrome = $false; whisper = $false }

Say 'Браузер'
$Chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($Chrome) { $Feat.chrome = $true; Write-Host 'Помощник получит отдельное окно Chrome со своим профилем: войди в нём на нужные сайты один раз.' }
else { Write-Host 'Google Chrome не найден: браузер будет работать на сервере.' }

Say 'Голосовые'
$WhisperDir = Join-Path $M 'whisper'
if ((Ask 'Расшифровывать голосовые на этом компьютере (скачает ~650 МБ)? (да/нет)' 'нет') -eq 'да') {
  try {
    $rel = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10'
    $asset = $rel | ForEach-Object { $_.assets } | Where-Object { $_.name -eq "whisper-bin-$Arch.zip" -or ($Arch -eq 'arm64' -and $_.name -eq 'whisper-bin-win-cpu-arm64.zip') } | Select-Object -First 1
    if (-not $asset) { throw 'нет готовой сборки' }
    $zip = Join-Path $env:TEMP 'mf-whisper.zip'
    Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $zip
    Expand-Archive -Force $zip $WhisperDir; Remove-Item $zip
    $model = Join-Path $WhisperDir 'ggml-large-v3-turbo-q5_0.bin'
    if (-not (Test-Path $model)) { Invoke-WebRequest -UseBasicParsing 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin' -OutFile $model }
    # whisper-server converts voice messages with ffmpeg (--convert).
    if (-not (Test-Path (Join-Path $WhisperDir 'ffmpeg.exe'))) {
      $fz = Join-Path $env:TEMP 'mf-ffmpeg.zip'
      Invoke-WebRequest -UseBasicParsing 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $fz
      Expand-Archive -Force $fz (Join-Path $env:TEMP 'mf-ffmpeg')
      Copy-Item (Get-ChildItem -Recurse (Join-Path $env:TEMP 'mf-ffmpeg') -Filter ffmpeg.exe | Select-Object -First 1).FullName $WhisperDir
      Remove-Item -Recurse -Force $fz, (Join-Path $env:TEMP 'mf-ffmpeg')
    }
    $Feat.whisper = $true
  } catch { Write-Host "Голосовые не поставились ($($_.Exception.Message)): их будет расшифровывать сервер." }
}

Say 'Подключаюсь к серверу'
$Key = Join-Path $env:USERPROFILE '.ssh\mainframe_bridge'
New-Item -ItemType Directory -Force -Path (Split-Path $Key) | Out-Null
# One raw argument string: an empty passphrase survives both Windows PowerShell 5.1 and PowerShell 7.
if (-not (Test-Path $Key)) { Start-Process -FilePath $Keygen -ArgumentList "-t ed25519 -N `"`" -C mainframe-bridge-$env:COMPUTERNAME -f `"$Key`" -q" -Wait -NoNewWindow }
if (-not (Test-Path "$Key.pub")) { throw 'Не получилось создать ключ (ssh-keygen).' }
$body = @{ token = $MfToken; os = 'windows'; user = $env:USERNAME; pubkey = (Get-Content "$Key.pub" -Raw).Trim(); hostname = $env:COMPUTERNAME; features = $Feat } | ConvertTo-Json -Compress
try { $out = Invoke-RestMethod -Method Post -Uri "$MfUrl/bridge/register" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) }
catch { throw 'Сервер не принял подключение. Возьми новую команду в пульте (код действует час и один раз).' }
if (-not $out.sshHost) { throw 'Сервер не сообщил свой адрес.' }
$Kh = Join-Path $M 'known_hosts'
if ($out.hostKey) { "$($out.sshHost) $($out.hostKey)" | Set-Content -Encoding ascii $Kh; $Check = 'yes' } else { '' | Set-Content -Encoding ascii $Kh; $Check = 'accept-new' }

Say 'Службы моста (запускаются сами при входе в Windows)'
# Every service runs in a hidden loop: if it falls, it starts again in 10 seconds.
$Vbs = Join-Path $M 'hidden.vbs'
'CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & WScript.Arguments(0) & """", 0, False' | Set-Content -Encoding ascii $Vbs
function Add-Service($name, $exe, [string[]]$argList, $extraPath = '') {
  $task = "$Prefix-$name"
  $loop = Join-Path $M "$name.ps1"
  $quoted = ($argList | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ', '
  @"
`$env:Path = '$NodeDir;$extraPath;' + `$env:Path
while (`$true) {
  & '$exe' @($quoted) *>> '$(Join-Path $M "logs\$name.log")'
  Start-Sleep -Seconds 10
}
"@ | Set-Content -Encoding utf8 $loop
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$Vbs`" `"$loop`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Мост помощника' | Out-Null
  Start-ScheduledTask -TaskName $task
}

$fwd = @('-R', "127.0.0.1:$($Ports.computer):127.0.0.1:$($Ports.computer)")
Add-Service 'computer' $Uvx @('--python', '3.14', 'windows-mcp', 'serve', '--transport', 'streamable-http', '--host', '127.0.0.1', '--port', "$($Ports.computer)")
if ($Feat.chrome) {
  # Chrome opens its window at login (a normal window, not hidden).
  Unregister-ScheduledTask -TaskName "$Prefix-chrome" -Confirm:$false -ErrorAction SilentlyContinue
  $ca = New-ScheduledTaskAction -Execute $Chrome -Argument "--user-data-dir=`"$(Join-Path $M 'chrome-profile')`" --remote-debugging-port=$($Ports.debug) --remote-debugging-address=127.0.0.1 --no-first-run --no-default-browser-check --restore-last-session"
  Register-ScheduledTask -TaskName "$Prefix-chrome" -Action $ca -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Principal (New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited) -Description 'Chrome помощника' | Out-Null
  Start-ScheduledTask -TaskName "$Prefix-chrome"
  Add-Service 'browser' $Node @($Sg, '--stdio', "`"$Node`" `"$Cdt`" --browserUrl http://127.0.0.1:$($Ports.debug) --usageStatistics false --performanceCrux false --screenshotFormat jpeg --screenshotMaxWidth 1280", '--outputTransport', 'streamableHttp', '--stateful', '--port', "$($Ports.chrome)")
  $fwd += @('-R', "127.0.0.1:$($Ports.chrome):127.0.0.1:$($Ports.chrome)")
}
if ($Feat.whisper) {
  $ws = Get-ChildItem -Recurse $WhisperDir -Filter whisper-server.exe | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path (Join-Path $WhisperDir 'tmp') | Out-Null
  Add-Service 'whisper' $ws.FullName @('--host', '127.0.0.1', '--port', "$($Ports.whisper)", '-m', (Join-Path $WhisperDir 'ggml-large-v3-turbo-q5_0.bin'), '-l', 'ru', '-nt', '-bo', '1', '--convert', '--inference-path', '/v1/audio/transcriptions', '--tmp-dir', (Join-Path $WhisperDir 'tmp')) $WhisperDir
  $fwd += @('-R', "127.0.0.1:$($Ports.whisper):127.0.0.1:$($Ports.whisper)")
}
Add-Service 'tunnel' $Ssh (@('-N', '-i', $Key, '-p', "$($out.sshPort)", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$Kh", '-o', "StrictHostKeyChecking=$Check", '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3') + $fwd + @("$($out.sshUser)@$($out.sshHost)"))

Start-Sleep -Seconds 8
Say 'Готово. Компьютер подключён к помощнику.'
Write-Host 'Работает, пока компьютер включён. Когда он выключен, сервер продолжает работу без него.'
if ($Feat.chrome) { Write-Host 'Открылось окно Chrome помощника: войди в нём на сайты, с которыми он будет работать.' }
Write-Host "Логи: $M\logs. Отключить мост: Get-ScheduledTask '$Prefix-*' | Unregister-ScheduledTask -Confirm:`$false"
