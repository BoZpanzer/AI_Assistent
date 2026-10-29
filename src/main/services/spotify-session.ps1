param([switch]$Probe)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $type = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  if (-not $taskMethod) { throw 'WinRT AsTask unavailable' }
  $genericTask = $taskMethod.MakeGenericMethod($type)
  while ($true) {
    $playing = $false
    try {
      $op = $type::RequestAsync()
      $task = $genericTask.Invoke($null, @($op))
      if (-not $task.Wait(5000)) { throw 'Media session timeout' }
      $manager = $task.Result
      foreach ($session in $manager.GetSessions()) {
        if ([string]$session.SourceAppUserModelId -match '(?i)spotify') {
          $info = $session.GetPlaybackInfo()
          if ($info -and [string]$info.PlaybackStatus -eq 'Playing') { $playing = $true; break }
        }
      }
      if (-not $playing) {
        $proc = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match ' - ' } | Select-Object -First 1
        if ($proc) { $playing = $true }
      }
    } catch { $playing = $false }
    if ($playing) { [Console]::WriteLine('PLAYING') } else { [Console]::WriteLine('STOPPED') }
    [Console]::Out.Flush()
    if ($Probe) { exit 0 }
    Start-Sleep -Seconds 1
  }
} catch {
  [Console]::WriteLine('STOPPED')
  exit 1
}
