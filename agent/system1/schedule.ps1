# System 1 (docs/SYSTEM1_PLAN.md, J8b): the nightly fine-tune as a Windows scheduled task.
#
#   powershell -NoProfile -File agent/system1/schedule.ps1               shows whether the task exists and when it ran
#   powershell -NoProfile -File agent/system1/schedule.ps1 -Register     every night at 01:00 (-At 02:30 for another time)
#   powershell -NoProfile -File agent/system1/schedule.ps1 -Unregister   removes it
#
# The task runs `node agent/system1-train.mjs --nightly` for the signed-in user: no training when the data has not
# changed, otherwise about three hours of CPU; an accepted checkpoint is loaded by the running watcher. It wakes the
# computer, runs only on mains power (Windows' default for tasks), and stops after six hours. The output is appended
# to agent/state/system1/nightly.log. A console window may flash once when it starts.
param([switch]$Register, [switch]$Unregister, [string]$At = '01:00')

$name = 'Ticket Intelligence - System 1 nightly fine-tune'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue

if ($Unregister) {
  if ($task) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; "Removed: $name" } else { "Not registered: $name" }
  return
}
if ($Register) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $log = Join-Path $root 'agent\state\system1\nightly.log'
  $command = "& '$node' agent/system1-train.mjs --nightly *>> '$log'"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$command`"" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
  $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Fine-tunes the System 1 model on the latest data and keeps it only if it is not worse (docs/SYSTEM1_PLAN.md, J8b).' -Force | Out-Null
  "Registered: $name, every day at $At"
  return
}
if ($task) {
  $info = Get-ScheduledTaskInfo -TaskName $name
  "Registered: $name"
  "  next run: $($info.NextRunTime)   last run: $($info.LastRunTime) (result $($info.LastTaskResult))"
} else {
  "Not registered. To run the fine-tune every night: powershell -NoProfile -File agent/system1/schedule.ps1 -Register"
}
