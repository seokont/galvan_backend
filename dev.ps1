$ErrorActionPreference = 'Stop'
$previousPath = $env:PATH
try {
    $localNode = Get-ChildItem -LiteralPath "$PSScriptRoot\..\.tools" -Directory -Filter 'node-*-win-x64' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($localNode) {
        $env:PATH = "$($localNode.FullName);$env:PATH"
    }
    Push-Location $PSScriptRoot
    try {
        & npm.cmd run start:dev
        $result = $LASTEXITCODE
    } finally {
        Pop-Location
    }
} finally {
    $env:PATH = $previousPath
}
exit $result
