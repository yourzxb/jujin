$ErrorActionPreference = 'Stop'
$workbenchRoot = $PSScriptRoot
$workbenchPidPath = Join-Path $workbenchRoot 'logs\server.pid'
if (-not (Test-Path -LiteralPath $workbenchPidPath)) {
    Write-Output 'No managed workbench process was found.'
    exit 0
}
$workbenchPidText = (Get-Content -LiteralPath $workbenchPidPath -Raw).Trim()
if ($workbenchPidText -notmatch '^\d+$') { throw 'Invalid process ID file.' }
$workbenchProcessId = [int]$workbenchPidText
$workbenchProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $workbenchProcessId) -ErrorAction SilentlyContinue
if ($workbenchProcess) {
    $workbenchExpected = Join-Path $workbenchRoot 'server.mjs'
    if ($workbenchProcess.Name -ne 'node.exe' -or -not $workbenchProcess.CommandLine -or $workbenchProcess.CommandLine.IndexOf($workbenchExpected, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        throw 'The process ID belongs to another program. It was not stopped.'
    }
    Stop-Process -Id $workbenchProcessId
    Write-Output 'Workbench stopped. All saved data remains in the data folder.'
} else {
    Write-Output 'Workbench is already stopped.'
}
Remove-Item -LiteralPath $workbenchPidPath -ErrorAction SilentlyContinue
