<#
이어온 로컬 실행 도우미. 서버·연결부·공유 App Server를 백그라운드로 켜고 끄고 상태를 본다.
  pwsh scripts/ieon.ps1 start [-Shared] [-Live]   서버·연결부 시작(-Shared: 공유 App Server도, -Live: 실제 엔진 실행 켬)
  pwsh scripts/ieon.ps1 stop                      이 스크립트가 띄운 프로세스만 종료하고 live를 끈다
  pwsh scripts/ieon.ps1 status                    포트·프로세스·엔진 상태
  pwsh scripts/ieon.ps1 claude                    새 창에서 Claude 이어온 채널 세션 시작(사람이 쓰는 터미널)
  pwsh scripts/ieon.ps1 tui                       새 창에서 공유 App Server에 붙은 Codex TUI 시작
  pwsh scripts/ieon.ps1 messenger                 메신저 봇(텔레그램·디스코드·슬랙) 시작. 봇 토큰은 .local/.env에서 그 프로세스만 읽는다
  pwsh scripts/ieon.ps1 check                     설치 점검: Node·부품·설정 파일, Codex·Claude Code 설치와 로그인 여부(모델 호출 없음)
설정·토큰은 .local/ 아래에 둔다(git 무시). 토큰 원문은 출력하지 않는다. 모든 포트는 127.0.0.1 전용이다.
#>
param(
  [Parameter(Position = 0, Mandatory)][ValidateSet('start', 'stop', 'status', 'claude', 'tui', 'messenger', 'check')][string]$Command,
  [switch]$Shared,
  [switch]$Live
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Local = Join-Path $Root '.local'
$Run = Join-Path $Local 'run'
$Codex = Join-Path $Root 'node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe'
$TestThread = '01a18790-63c7-73e3-a60b-6ddb60fd5be8'
$ConnectorConfig = Join-Path $Local 's2\connector.json'
New-Item -ItemType Directory -Force $Run | Out-Null

function Get-Listening([int]$Port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) }

function Set-Live([bool]$On) {
  $cfg = Get-Content $ConnectorConfig -Raw | ConvertFrom-Json
  $cfg.live = $On
  $cfg | ConvertTo-Json -Depth 8 | Set-Content $ConnectorConfig -Encoding utf8
}

function Start-Owned([string]$Name, [string]$File, [string[]]$Arguments) {
  $pidFile = Join-Path $Run "$Name.pid"
  if ((Test-Path $pidFile) -and (Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue)) {
    Write-Output "${Name}: 이미 실행 중"
    return
  }
  $p = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru `
    -RedirectStandardError (Join-Path $Run "$Name.log") -RedirectStandardOutput (Join-Path $Run "$Name.out")
  Set-Content $pidFile $p.Id
  Write-Output "${Name}: 시작(PID $($p.Id))"
}

function Stop-Owned([string]$Name) {
  $pidFile = Join-Path $Run "$Name.pid"
  if (-not (Test-Path $pidFile)) { return }
  $p = Get-Process -Id (Get-Content $pidFile) -ErrorAction SilentlyContinue
  # 이 스크립트가 띄운 node/codex 프로세스만 끈다. PID가 재사용됐으면 건드리지 않는다.
  if ($p -and $p.ProcessName -in @('node', 'codex')) { Stop-Process -Id $p.Id -Confirm:$false; Write-Output "${Name}: 종료" }
  Remove-Item $pidFile -Confirm:$false
}

switch ($Command) {
  'start' {
    if ($Shared) {
      $hash = Get-Content (Join-Path $Local 'x2\token.sha256') -Raw
      Start-Owned 'app-server' $Codex @('app-server', '--listen', 'ws://127.0.0.1:28761', '--ws-auth', 'capability-token', '--ws-token-sha256', $hash.Trim())
    }
    # 연결부는 시작할 때만 설정을 읽는다. 이미 돌고 있으면 live를 바꾸지 않는다(바꾸려면 stop 후 start).
    $connectorPid = Join-Path $Run 'connector.pid'
    $connectorRunning = (Test-Path $connectorPid) -and (Get-Process -Id (Get-Content $connectorPid) -ErrorAction SilentlyContinue)
    if (-not $connectorRunning) { Set-Live $Live.IsPresent }
    Start-Owned 'server' 'node' @('src/pilot/server.mjs', '.local/s2/server.json')
    Start-Sleep -Seconds 1
    Start-Owned 'connector' 'node' @('src/pilot/connector.mjs', '.local/s2/connector.json')
    $liveNow = (Get-Content $ConnectorConfig -Raw | ConvertFrom-Json).live
    Write-Output "실제 엔진 실행: $(if ($liveNow) { '켬' } else { '끔' }) · 웹: http://127.0.0.1:28760"
  }
  'stop' {
    'messenger', 'connector', 'server', 'app-server' | ForEach-Object { Stop-Owned $_ }
    Set-Live $false
    Write-Output '실제 엔진 실행: 끔'
  }
  'status' {
    $live = (Get-Content $ConnectorConfig -Raw | ConvertFrom-Json).live
    [pscustomobject]@{
      '이어온 서버(28760)'   = Get-Listening 28760
      '공유 App Server(28761)' = Get-Listening 28761
      'Claude 채널(28762)'    = Get-Listening 28762
      '실제 엔진 실행'         = $live
      '시험 Codex 대화 잠금'   = (pwsh -NoProfile -File (Join-Path $Root 'src\pilot\lock-probe.ps1') -ThreadId $TestThread | ConvertFrom-Json).outcome
    } | Format-List
  }
  'messenger' {
    if (-not (Get-Listening 28760)) { throw '이어온 서버가 꺼져 있습니다. start로 먼저 켜세요.' }
    Start-Owned 'messenger' 'node' @('src/pilot/messenger/main.mjs', '.local/messenger/config.json')
    Start-Sleep -Seconds 3
    Get-Content (Join-Path $Run 'messenger.log') -Tail 3
  }
  'claude' {
    Start-Process pwsh -WorkingDirectory (Join-Path $Local 'c1') -ArgumentList @('-NoExit', '-Command', 'claude --dangerously-load-development-channels server:ieon')
    Write-Output '새 창에서 Claude 채널 세션을 시작했습니다. 하단이 manual mode인지 확인하세요.'
  }
  'check' {
    # 설치·로그인 여부만 본다. 모델 호출·로그인·설정 변경은 하지 않고 계정 이메일·토큰은 출력하지 않는다.
    $rows = [Collections.Generic.List[object]]::new()
    function Add-Row([string]$Item, [bool]$Ok, [string]$Detail, [string]$Fix) {
      $rows.Add([pscustomobject]@{ 결과 = $(if ($Ok) { 'OK' } else { '확인 필요' }); 항목 = $Item; 내용 = $Detail; 할일 = $(if ($Ok) { '' } else { $Fix }) })
    }

    $node = (Get-Command node -ErrorAction SilentlyContinue) ? (node --version) : $null
    Add-Row 'Node.js 24' ($node -like 'v24.*') ($node ?? '없음') 'nodejs.org에서 v24 설치 후 PowerShell 새로 열기'
    $sdk = Test-Path (Join-Path $Root 'node_modules\@openai\codex-sdk')
    Add-Row '부품(npm install)' $sdk $(if ($sdk) { '@openai/codex-sdk 있음' } else { '없음' }) 'npm install'
    $configs = 's2\server.json', 's2\connector.json', 's2\user-token', 's2\device-token' | Where-Object { -not (Test-Path (Join-Path $Local $_)) }
    Add-Row '설정 파일(.local)' (-not $configs) $(if ($configs) { "없음: $($configs -join ', ')" } else { '있음' }) '따라 하기 설명서 1-5로 만들기'

    $codexOk = $false
    if (Test-Path $Codex) {
      $ver = (& $Codex --version 2>$null) -join ' '
      Add-Row 'Codex 실행 파일(이어온 폴더 안)' $true $ver ''
      $login = (& $Codex login status 2>&1) -join ' '
      $codexOk = $LASTEXITCODE -eq 0 -and $login -match 'Logged in'
      Add-Row 'Codex 로그인' $codexOk $(if ($codexOk) { $login.Trim() } else { '로그인 안 됨' }) "& '$Codex' login 으로 직접 로그인"
    } else {
      Add-Row 'Codex 실행 파일(이어온 폴더 안)' $false '없음' 'npm install'
    }

    $claudeOk = $false
    if (Get-Command claude -ErrorAction SilentlyContinue) {
      Add-Row 'Claude Code 설치' $true ((claude --version 2>$null) -join ' ') ''
      $auth = try { (claude auth status 2>$null) -join "`n" | ConvertFrom-Json } catch { $null }
      $sub = $auth.subscriptionType
      $claudeOk = [bool]$auth.loggedIn -and $auth.authMethod -eq 'claude.ai' -and $sub -in 'pro', 'max'
      $detail = if (-not $auth.loggedIn) { '로그인 안 됨' } else { "방식 $($auth.authMethod), 구독 $($sub ?? '없음')" }
      Add-Row 'Claude Code 로그인(구독 계정)' $claudeOk $detail 'pwsh scripts/ieon.ps1 claude 창에서 /login(Pro/Max 구독 계정, API 키 아님)'
    } else {
      Add-Row 'Claude Code 설치' $false 'claude 명령 없음' 'npm install -g @anthropic-ai/claude-code 후 PowerShell 새로 열기'
    }

    $rows | Format-Table -AutoSize -Wrap
    $base = $node -like 'v24.*' -and $sdk -and -not $configs
    Write-Output "Codex 사용: $(if ($codexOk) { '가능' } else { '불가' }) · Claude 사용: $(if ($claudeOk) { '가능' } else { '불가' })"
    if (-not $base -or -not ($codexOk -or $claudeOk)) {
      Write-Output '이어온을 쓰려면 위 "확인 필요" 항목을 처리하세요(엔진은 Codex·Claude 중 하나 이상 필요).'
      exit 1
    }
    Write-Output '설치 점검 통과.'
  }
  'tui' {
    if (-not (Get-Listening 28761)) { throw '공유 App Server가 꺼져 있습니다. start -Shared로 먼저 켜세요.' }
    $cmd = "`$env:IEON_X2_TOKEN = (Get-Content '$Local\x2\token' -Raw).Trim(); & '$Codex' resume $TestThread --remote ws://127.0.0.1:28761 --remote-auth-token-env IEON_X2_TOKEN"
    Start-Process pwsh -WorkingDirectory $Root -ArgumentList @('-NoExit', '-Command', $cmd)
    Write-Output '새 창에서 Codex TUI를 시작했습니다. Codex 앱에서는 이 대화를 열지 마세요.'
  }
}
