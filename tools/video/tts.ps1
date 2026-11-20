# 장면별 목소리 WAV 만들기(Windows 목소리 — 한국어 Heami, 영어는 -Culture en-US로 Zira 등). 인수: 목록 JSON 파일(id·say), 출력 폴더
param([Parameter(Mandatory)][string]$List, [Parameter(Mandatory)][string]$Out, [string]$Culture = 'ko-KR')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$items = Get-Content $List -Raw -Encoding UTF8 | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq $Culture } | Select-Object -First 1
if (-not $v) { throw "$Culture voice not installed" }
$s.SelectVoice($v.VoiceInfo.Name)
$s.Rate = 0
foreach ($it in $items) {
  $f = Join-Path $Out ($it.id + '.wav')
  $s.SetOutputToWaveFile($f)
  $s.Speak($it.say)
}
$s.SetOutputToNull()
$s.Dispose()
Write-Output "voice: $($v.VoiceInfo.Name), files: $($items.Count)"
