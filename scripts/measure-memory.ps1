param([int]$PlayerProcessId = 0)
$ErrorActionPreference = 'Stop'
$nonsWorkspace = Split-Path $PSScriptRoot -Parent
$nonsProcesses = Get-CimInstance Win32_Process
if (-not $PlayerProcessId) {
    $nonsCandidates = @($nonsProcesses | Where-Object { $_.Name -eq 'Nons.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($nonsWorkspace, [StringComparison]::OrdinalIgnoreCase) })
    if ($nonsCandidates.Count -ne 1) { throw 'Run one NonsPlayer instance or specify -PlayerProcessId.' }
    $PlayerProcessId = $nonsCandidates[0].ProcessId
}
$nonsIds = [Collections.Generic.HashSet[uint32]]::new()
[void]$nonsIds.Add([uint32]$PlayerProcessId)
do {
    $nonsChanged = $false
    foreach ($nonsProcess in $nonsProcesses) {
        if ($nonsIds.Contains([uint32]$nonsProcess.ParentProcessId) -and $nonsIds.Add([uint32]$nonsProcess.ProcessId)) { $nonsChanged = $true }
    }
} while ($nonsChanged)
$nonsMembers = @($nonsProcesses | Where-Object { $nonsIds.Contains([uint32]$_.ProcessId) })
$nonsTotal = ($nonsMembers | Measure-Object -Property WorkingSetSize -Sum).Sum
[pscustomobject]@{ CapturedAt = (Get-Date -Format o); RootProcessId = $PlayerProcessId; Processes = $nonsMembers.Count; WorkingSetMiB = [math]::Round($nonsTotal / 1MB, 2); Scope = 'NonsPlayer plus descendants including WebView; shared pages may be counted more than once' }
