# lock-probe.ps1과 같은 읽기 전용 잠금 검사를, 한 번 띄워 둔 채 줄마다 반복한다(2026-11-23 인수 시험: 질문마다 PowerShell을 새로 띄우는 데 1.5초).
# 입력 한 줄: "<threadId>" 또는 "<threadId>`t<lockPath>" → 출력 한 줄: 결과 JSON(한 줄). 생성·삭제·쓰기 없음, 업무 대화는 검사하지 않는다.
$ErrorActionPreference = 'Stop'
$excluded = '01a0dadd-739f-74d2-93c5-9c405cc1019b'  # 업무 대화. 검증 대상에서 제외됨
$lockRoot = Join-Path $env:USERPROFILE '.codex\thread-writer-locks'
Add-Type -Namespace IeonProbe -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool LockFileEx(Microsoft.Win32.SafeHandles.SafeFileHandle h, uint flags, uint reserved, uint lowBytes, uint highBytes, ref System.Threading.NativeOverlapped o);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool UnlockFileEx(Microsoft.Win32.SafeHandles.SafeFileHandle h, uint reserved, uint lowBytes, uint highBytes, ref System.Threading.NativeOverlapped o);
'@
function Probe([string]$threadId, [string]$lockPath) {
  $r = [ordered]@{ threadId = $threadId; atUtc = [DateTime]::UtcNow.ToString('o'); attempts = 0; outcome = $null; winError = $null; probeHandleClosed = $false
    sourceFileCreated = $false; sourceBytesWritten = 0; modelTurnStarts = 0; threadResumeRequests = 0 }
  if ($threadId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' -or $threadId -eq $excluded) { $r.outcome = 'LOCK_CHECK_ERROR'; return $r }
  if (-not $lockPath) { $lockPath = Join-Path $lockRoot "$threadId.lock" }
  if (-not (Test-Path -LiteralPath $lockPath)) { $r.outcome = 'NO_LOCK_FILE'; return $r }
  $h = [IeonProbe.Native]::CreateFileW($lockPath, [uint32]2147483648, 0x7, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
  if ($h.IsInvalid) { $r.outcome = 'OPEN_FAILED'; $r.winError = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); return $r }
  try {
    $o = New-Object System.Threading.NativeOverlapped
    $r.attempts = 1
    if ([IeonProbe.Native]::LockFileEx($h, 0x1, 0, [uint32]::MaxValue, [uint32]::MaxValue, [ref]$o)) {
      [void][IeonProbe.Native]::UnlockFileEx($h, 0, [uint32]::MaxValue, [uint32]::MaxValue, [ref]$o)
      $r.outcome = 'NO_WRITER_LOCK'
    } else {
      $r.winError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $r.outcome = if ($r.winError -eq 33) { 'WRITER_LOCK_CONFLICT' } else { 'LOCK_CHECK_ERROR' }
    }
  } finally { $h.Dispose(); $r.probeHandleClosed = $true }
  return $r
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Trim() -split "`t", 2
  try { $res = Probe $parts[0] ($(if ($parts.Count -gt 1) { $parts[1] } else { '' })) } catch { $res = [ordered]@{ threadId = $parts[0]; outcome = 'LOCK_CHECK_ERROR' } }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
