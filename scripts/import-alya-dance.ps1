param(
  [Parameter(Mandatory=$true)][string]$ZipPath
)
$ErrorActionPreference = 'Stop'
$branch = 'fix/calendar-alya-spotify-20261029'
$repo = 'https://github.com/BoZpanzer/AI_Assistent.git'
$zip = (Resolve-Path -LiteralPath $ZipPath).Path
$work = Join-Path $env:TEMP ('jarvis-alya-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  git clone --depth 1 --branch $branch $repo (Join-Path $work 'repo')
  if ($LASTEXITCODE -ne 0) { throw 'Git clone fehlgeschlagen. Bitte GitHub-Anmeldung pruefen.' }
  $unzip = Join-Path $work 'images'
  Expand-Archive -LiteralPath $zip -DestinationPath $unzip -Force
  $images = @(Get-ChildItem -LiteralPath $unzip -Recurse -Filter '*.png' -File)
  if ($images.Count -ne 22) { throw "22 PNG-Dateien erwartet, gefunden: $($images.Count)" }
  $target = Join-Path $work 'repo/src/renderer/assets/pet/frau/dance'
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  foreach ($file in $images) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $target $file.Name) -Force }
  Push-Location (Join-Path $work 'repo')
  try {
    git add -- src/renderer/assets/pet/frau/dance
    git diff --cached --stat
    git commit -m 'assets: add 22 Alya dance and jump frames'
    if ($LASTEXITCODE -ne 0) { throw 'Git commit fehlgeschlagen.' }
    git push origin $branch
    if ($LASTEXITCODE -ne 0) { throw 'Git push fehlgeschlagen. Bitte GitHub-Anmeldung pruefen.' }
  } finally { Pop-Location }
  Write-Host 'Erfolg: 22 Alya-Frames wurden in Pull Request #39 gepusht.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
