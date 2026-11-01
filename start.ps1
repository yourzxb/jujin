param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$workbenchRoot = $PSScriptRoot
$workbenchUrl = 'http://127.0.0.1:8765'
$workbenchLogs = Join-Path $workbenchRoot 'logs'
New-Item -ItemType Directory -Path $workbenchLogs -Force | Out-Null
function Test-WorkbenchHealth {
    try {
        $health = Invoke-RestMethod -Uri ($workbenchUrl + '/api/health') -TimeoutSec 2
        return ($health.ok -eq $true -and $health.app -eq 'passive-income-workbench')
    } catch { return $false }
}
if (-not (Test-WorkbenchHealth)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $workbenchNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }
    if (-not $workbenchNode) {
        $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $bundledNode) { $workbenchNode = $bundledNode }
    }
    if (-not $workbenchNode) { throw 'Node.js was not found. Install Node.js 22 or newer and try again.' }
    $workbenchMajor = [int]((& $workbenchNode --version) -replace '^v(\d+).*$', '$1')
    if ($workbenchMajor -lt 22) { throw 'Node.js 22 or newer is required.' }
    $workbenchServer = Join-Path $workbenchRoot 'server.mjs'
    $workbenchPreviousPort = $env:PORT
    try {
        $env:PORT = '8765'
        $workbenchProcess = Start-Process -FilePath $workbenchNode -ArgumentList @(('"' + $workbenchServer + '"')) -WorkingDirectory $workbenchRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $workbenchLogs 'server.log') -RedirectStandardError (Join-Path $workbenchLogs 'server-error.log') -PassThru
    } finally { $env:PORT = $workbenchPreviousPort }
    $workbenchReady = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        $workbenchProcess.Refresh()
        if ($workbenchProcess.HasExited) {
            $failureText = Get-Content -LiteralPath (Join-Path $workbenchLogs 'server-error.log') -Raw -ErrorAction SilentlyContinue
            throw ('The workbench could not start. ' + $failureText)
        }
        if (Test-WorkbenchHealth) { $workbenchReady = $true; break }
    }
    if (-not $workbenchReady) {
        Stop-Process -Id $workbenchProcess.Id -ErrorAction SilentlyContinue
        throw 'The workbench did not become ready. Check logs/server-error.log.'
    }
    $workbenchProcess.Id | Set-Content -LiteralPath (Join-Path $workbenchLogs 'server.pid') -Encoding ASCII
}
Write-Output ('Workbench is ready: ' + $workbenchUrl)
if (-not $NoBrowser) { Start-Process $workbenchUrl }
