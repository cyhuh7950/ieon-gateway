# X0 Codex thread writer 잠금 읽기 전용 검사 1회.
# 파일을 쓰기 권한 없이 열고 비차단 공유 잠금을 1회 요청한 뒤 바로 닫는다. 생성·삭제·쓰기 없음.
param(
  [Parameter(Mandatory)][string]$ThreadId,
  [string]$LockRoot = (Join-Path $env:USERPROFILE '.codex\thread-writer-locks'),
  [string]$LockPath
)
$ErrorActionPreference = 'Stop'
$excluded = '01a0dadd-739f-74d2-93c5-9c405cc1019b'  # 업무 대화. 검증 대상에서 제외됨
if ($ThreadId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'INVALID_THREAD_ID' }
if ($ThreadId -eq $excluded) { throw 'EXCLUDED_THREAD' }
if (-not $LockPath) { $LockPath = Join-Path $LockRoot "$ThreadId.lock" }

Add-Type -Namespace IeonProbe -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern Microsoft.Win32.SafeHandles.SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr sec, uint disposition, uint flags, IntPtr template);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool LockFileEx(Microsoft.Win32.SafeHandles.SafeFileHandle h, uint flags, uint reserved, uint lowBytes, uint highBytes, ref System.Threading.NativeOverlapped o);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool UnlockFileEx(Microsoft.Win32.SafeHandles.SafeFileHandle h, uint reserved, uint lowBytes, uint highBytes, ref System.Threading.NativeOverlapped o);
'@

$result = [ordered]@{
  threadId = $ThreadId; atUtc = [DateTime]::UtcNow.ToString('o'); attempts = 0
  outcome = $null; winError = $null; probeHandleClosed = $false
  sourceFileCreated = $false; sourceBytesWritten = 0; modelTurnStarts = 0; threadResumeRequests = 0
}
if (-not (Test-Path -LiteralPath $LockPath)) {
  $result.outcome = 'NO_LOCK_FILE'  # 한 번도 재개되지 않았거나 정리된 상태. 잠금 없음과 같다고 단정하지 않는다
  $result | ConvertTo-Json; return
}
# GENERIC_READ, share READ|WRITE|DELETE, OPEN_EXISTING
$h = [IeonProbe.Native]::CreateFileW($LockPath, [uint32]2147483648, 0x7, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
if ($h.IsInvalid) { $result.outcome = 'OPEN_FAILED'; $result.winError = [Runtime.InteropServices.Marshal]::GetLastWin32Error(); $result | ConvertTo-Json; return }
try {
  $o = New-Object System.Threading.NativeOverlapped
  $result.attempts = 1
  # LOCKFILE_FAIL_IMMEDIATELY(1), 공유 잠금, 전체 범위
  if ([IeonProbe.Native]::LockFileEx($h, 0x1, 0, [uint32]::MaxValue, [uint32]::MaxValue, [ref]$o)) {
    [void][IeonProbe.Native]::UnlockFileEx($h, 0, [uint32]::MaxValue, [uint32]::MaxValue, [ref]$o)
    $result.outcome = 'NO_WRITER_LOCK'
  } else {
    $result.winError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    $result.outcome = if ($result.winError -eq 33) { 'WRITER_LOCK_CONFLICT' } else { 'LOCK_CHECK_ERROR' }
  }
} finally { $h.Dispose(); $result.probeHandleClosed = $true }
$result | ConvertTo-Json
