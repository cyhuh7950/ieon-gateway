# 장면별 목소리 WAV 만들기(Windows 한국어 Heami). 인수: 목록 JSON 파일(id·say), 출력 폴더
param([Parameter(Mandatory)][string]$List, [Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$items = Get-Content $List -Raw -Encoding UTF8 | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
if (-not $v) { throw '한국어 목소리가 없습니다' }
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
