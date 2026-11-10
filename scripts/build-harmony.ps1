param(
  [string]$DevEcoHome = 'D:\DevEcoStudio',
  [string]$OpenHarmonySdk = 'D:\OpenHarmonySdk',
  [string]$BuildRoot = 'D:\P07BuildRuns'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $projectRoot 'harmony-app'
$hvigor = Join-Path $DevEcoHome 'tools\hvigor\bin\hvigorw.bat'
if (-not (Test-Path -LiteralPath $hvigor)) { throw "Hvigor was not found at $hvigor" }
if (-not (Test-Path -LiteralPath (Join-Path $OpenHarmonySdk '26.0.0'))) {
  New-Item -ItemType Directory -Path $OpenHarmonySdk -Force | Out-Null
}

& node (Join-Path $PSScriptRoot 'sync-harmony.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$runName = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$run = Join-Path $BuildRoot $runName
New-Item -ItemType Directory -Path $run -Force | Out-Null
Get-ChildItem -LiteralPath $source -Force |
  Where-Object Name -NotIn @('.hvigor', 'build', 'oh_modules', '.idea', 'local.properties') |
  Copy-Item -Destination $run -Recurse -Force
Set-Content -LiteralPath (Join-Path $run 'local.properties') -Value ('sdk.dir=' + ($OpenHarmonySdk -replace '\\', '/')) -Encoding ascii

$env:DEVECO_HOME = $DevEcoHome
$env:DEVECO_SDK_HOME = Join-Path $DevEcoHome 'sdk'
$env:JAVA_HOME = Join-Path $DevEcoHome 'jbr'
$env:Path = (Join-Path $env:JAVA_HOME 'bin') + ';' + (Join-Path $DevEcoHome 'tools\node') + ';' + $env:Path
$evidence = Join-Path $projectRoot ('artifacts\harmony\' + $runName)
New-Item -ItemType Directory -Path $evidence -Force | Out-Null
Push-Location $run
try {
  & $hvigor assembleHap --mode module -p product=default -p buildMode=debug --no-daemon 2>&1 |
    Tee-Object -FilePath (Join-Path $evidence 'build.log')
  $result = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($result -ne 0) {
  Write-Error "ArkTS build failed. Log: $evidence\build.log; copied source: $run"
  exit $result
}
$haps = @(Get-ChildItem -LiteralPath (Join-Path $run 'entry\build') -Recurse -Filter '*.hap' -File -ErrorAction SilentlyContinue)
foreach ($hap in $haps) { Copy-Item -LiteralPath $hap.FullName -Destination $evidence -Force }
"BuildSource=$run"
"Evidence=$evidence"
"HapCount=$($haps.Count)"
