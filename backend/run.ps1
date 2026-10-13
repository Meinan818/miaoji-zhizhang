$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path $projectRoot '.cache/backend/tmp'
New-Item -ItemType Directory -Path $temporary -Force | Out-Null
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
Push-Location $PSScriptRoot
try {
    $env:TEMP = $temporary
    $env:TMP = $temporary
    & java "-Djava.io.tmpdir=$temporary" -jar './target/miaoji-backend-0.1.0.jar'
    $result = $LASTEXITCODE
} finally {
    Pop-Location
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}
exit $result
