<#
이어온 PC 설치(한 번만). 이 파일을 실행하면 나머지는 웹 화면에서 한다(설계 WEB_FIRST W6).
  pwsh scripts/install.ps1              설치·업데이트: 부품 설치, 설정 준비(토큰은 내부 생성), 로그온 시 자동 시작 등록, 지금 시작, 브라우저 열기
  pwsh scripts/install.ps1 -Uninstall   자동 시작·바로 가기 제거, 이어온 서버 종료(설정·대화 기록은 남김)
  pwsh scripts/install.ps1 -DryRun      바꿀 내용만 보여 주고 아무것도 바꾸지 않음
실제 실행(AI 호출)은 꺼진 채로 시작한다. 켜기·Codex 대화 허용·허브 연결·봇 토큰은 모두 웹 화면(http://127.0.0.1:28760)에서 한다.
#>
param([switch]$Uninstall, [switch]$DryRun, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Local = Join-Path $Root '.local'
$Run = Join-Path $Local 'run'
$Task = 'ieon-gateway'
$Url = 'http://127.0.0.1:28760/'
$Vbs = Join-Path $Run 'start-hidden.vbs'
$Shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) '이어온.url'

function Step([string]$Text) { Write-Output "· $Text" }
function Test-Up { try { (Invoke-WebRequest -Uri ($Url + 'health') -TimeoutSec 2 -UseBasicParsing).StatusCode -eq 200 } catch { $false } }
function Stop-Ieon {
  # 이어온 서버(127.0.0.1:28760을 연 node, 명령줄에 server.mjs)만 끈다. 서버가 띄운 연결부·메신저는 부모가 사라지면 5초 안에 스스로 끝난다.
  $pids = Get-NetTCPConnection -State Listen -LocalPort 28760 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $pids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -match 'server\.mjs') { Stop-Process -Id $p -Confirm:$false -ErrorAction SilentlyContinue }
  }
}

if ($Uninstall) {
  if ($DryRun) { Step "자동 시작 '$Task' 제거, 바로 가기 제거, 서버 종료(설정·기록 유지)"; return }
  Unregister-ScheduledTask -TaskName $Task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item $Shortcut -ErrorAction SilentlyContinue -Confirm:$false
  Stop-Ieon
  Write-Output '이어온 자동 시작을 없앴습니다. 설정과 대화 기록(.local)은 남겨 두었습니다.'
  return
}

# 1) Node.js 24
$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source
$ver = if ($node) { node --version } else { '' }
if ($ver -notlike 'v24.*') {
  Write-Output "Node.js 24가 필요합니다(지금: $(if ($ver) { $ver } else { '없음' })). nodejs.org에서 24를 설치한 뒤 이 설치를 다시 실행하세요."
  exit 1
}
Step "Node.js $ver"

# 2) 부품
if ($DryRun) { Step '부품 설치(npm ci) — 필요할 때만' }
elseif (-not (Test-Path (Join-Path $Root 'node_modules\@openai\codex-sdk'))) {
  Step '부품 설치 중(npm ci)…'
  Push-Location $Root; try { npm ci --no-audit --no-fund | Out-Null } finally { Pop-Location }
} else { Step '부품 있음' }

# 3) 설정 준비(처음이면 만들고, 있으면 필요한 것만 보탬. 토큰은 내부 생성, 값은 출력하지 않음)
if ($DryRun) { Step '설정 준비(.local): 서버·연결부·메신저 설정, 내부 토큰, 웹 입력용 봇 토큰 파일' }
else { Step (node (Join-Path $Root 'scripts\ieon-init.mjs') --web-first $Root) }

# 4) 로그온 시 창 없이 서버 시작(서버가 연결부·메신저를 함께 띄운다)
New-Item -ItemType Directory -Force $Run | Out-Null
# 서버 실행은 .cmd 파일에 두고, VBS는 그 파일을 창 없이 실행만 한다(경로에 빈칸이 있어도 되게 따옴표를 문자로 붙인다).
$CmdFile = Join-Path $Run 'start-server.cmd'
$cmdText = "@echo off`r`ncd /d `"$Root`"`r`nnode src\pilot\server.mjs .local\s2\server.json 2>> .local\run\server.log`r`n"
$q = '"'
$vbsText = 'CreateObject("WScript.Shell").Run ' + $q + $q + $q + $CmdFile + $q + $q + $q + ', 0, False'
if ($DryRun) { Step "자동 시작 등록: 작업 '$Task'(로그온할 때, 창 없음)"; Step "바로 가기: $Shortcut"; return }
Set-Content -Path $CmdFile -Value $cmdText -Encoding oem -NoNewline
Set-Content -Path $Vbs -Value $vbsText -Encoding unicode
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument """$Vbs"""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Description '이어온 서버(127.0.0.1:28760)' -Force | Out-Null
Step "자동 시작 등록: 작업 '$Task'"

# 5) 지금 시작(이미 떠 있으면 다시 시작해 새 설정을 읽게 함)
if (Test-Up) { Stop-Ieon; Start-Sleep -Seconds 2 }
Start-ScheduledTask -TaskName $Task
$ok = $false; foreach ($i in 1..20) { Start-Sleep -Milliseconds 500; if (Test-Up) { $ok = $true; break } }
if (-not $ok) { Write-Output "서버가 시작되지 않았습니다. $Run\server.log 를 확인하세요."; exit 1 }
Step '서버 시작됨(실제 실행은 꺼짐)'

# 6) 바로 가기와 브라우저
Set-Content -Path $Shortcut -Value "[InternetShortcut]`r`nURL=$Url`r`n" -Encoding ascii
if (-not $NoBrowser) { Start-Process $Url }
Write-Output "설치를 마쳤습니다. 바탕화면의 '이어온'을 열면 됩니다. 나머지 설정은 웹 화면의 '봇 관리'에서 하세요."
