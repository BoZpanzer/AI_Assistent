$ErrorActionPreference = 'SilentlyContinue'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $type = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1
  } | Select-Object -First 1
  if (-not $taskMethod) { throw 'WinRT AsTask unavailable' }
  $op = $type::RequestAsync()
  $task = $taskMethod.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(10000)) { throw 'Media session timeout' }
  $manager = $task.Result
  while ($true) {
    $playing = $false
    try {
      foreach ($session in $manager.GetSessions()) {
        if ([string]$session.SourceAppUserModelId -match '(?i)spotify') {
          $info = $session.GetPlaybackInfo()
          if ($info -and [string]$info.PlaybackStatus -eq 'Playing') { $playing = $true; break }
        }
      }
    } catch { $playing = $false }
    if ($playing) { [Console]::WriteLine('PLAYING') } else { [Console]::WriteLine('STOPPED') }
    Start-Sleep -Seconds 3
  }
} catch {
  [Console]::WriteLine('STOPPED')
  exit 1
}
