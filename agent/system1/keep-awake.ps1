# System 1 (docs/SYSTEM1_PLAN.md, J8b): keeps Windows from sleeping while a fine-tune runs, then lets it sleep again.
# A training run takes about three hours on the CPU; on 2026-11-15 the laptop slept through most of the night and
# ft-3 got half an epoch done. Idle sleep only: closing the lid still follows the power settings.
#
#   powershell -NoProfile -File agent/system1/keep-awake.ps1 -ProcessId <training PID>
param([Parameter(Mandatory = $true)][int]$ProcessId)

Add-Type -Namespace System1 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
$ES_CONTINUOUS = [uint32]'0x80000000'
$ES_SYSTEM_REQUIRED = [uint32]'0x00000001'
[void][System1.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED)
try {
  while (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }
} finally {
  [void][System1.Power]::SetThreadExecutionState($ES_CONTINUOUS)
}
