param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'secure-ipc.ps1')
Initialize-SecureIpc | Out-Null

function To-Bytes([double]$N, [string]$Unit) {
    switch ($Unit.ToLower()) {
        'tb' { return [int64]($N * 1TB) }
        'gb' { return [int64]($N * 1GB) }
        'mb' { return [int64]($N * 1MB) }
        'kb' { return [int64]($N * 1KB) }
        default { return [int64]$N }
    }
}

# The caller polls this file; DISM itself only reports progress on its own stdout,
# and an elevated run gives the app no way to read that stream directly.
function Write-ProgressFile([string]$Path, [string]$Json) {
    if (-not $Path) { return }
    try { [IO.File]::WriteAllText($Path, $Json, (New-Object Text.UTF8Encoding $false)) } catch { }
}

$result = @{ ok = $true; error = ''; action = '' }

try {
    if ($Payload -match '^[A-Za-z]:\\') {
        $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
        $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    }
    $result.action = [string]$req.action
    $prog = [string]$req.progress

    if ($req.action -eq 'analyze') {
        $raw = (Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore /English 2>&1 | Out-String)
        $d = @{ ok = $false }
        foreach ($pair in @(
            @('reported', 'Windows Explorer Reported Size of Component Store'),
            @('actual', 'Actual Size of Component Store'),
            @('shared', 'Shared with Windows'),
            @('backups', 'Backups and Disabled Features'),
            @('cachetemp', 'Cache and Temporary Data')
        )) {
            $m = [regex]::Match($raw, [regex]::Escape($pair[1]) + '\s*:\s*([\d]+(?:\.[\d]+)?)\s*(TB|GB|MB|KB|bytes)')
            if ($m.Success) { $d[$pair[0]] = (To-Bytes ([double]$m.Groups[1].Value) $m.Groups[2].Value) }
            else { $d[$pair[0]] = $null }
        }
        $mLast = [regex]::Match($raw, 'Date of Last Cleanup\s*:\s*(.+)')
        if ($mLast.Success) { $d.lastCleanup = $mLast.Groups[1].Value.Trim() }
        $mRec = [regex]::Match($raw, 'Number of Reclaimable Packages\s*:\s*(\d+)')
        if ($mRec.Success) { $d.reclaimable = [int]$mRec.Groups[1].Value }
        $mSug = [regex]::Match($raw, 'Component Store Cleanup Recommended\s*:\s*(\w+)')
        if ($mSug.Success) { $d.recommended = ($mSug.Groups[1].Value.ToLower() -eq 'yes') }
        if ($null -ne $d.actual) { $d.ok = $true }
        elseif ($raw -match 'Error:\s*740') { $d.needsAdmin = $true }
        else { $d.raw = $raw.Substring(0, [Math]::Min(400, $raw.Length)) }
        $result.data = $d
    } elseif ($req.action -eq 'cleanup' -or $req.action -eq 'cleanup-resetbase') {
        $dismArgs = @('/Online', '/Cleanup-Image', '/StartComponentCleanup', '/English', '/NoRestart')
        if ($req.action -eq 'cleanup-resetbase') { $dismArgs += '/ResetBase' }

        $sw = [Diagnostics.Stopwatch]::StartNew()
        $tail = New-Object System.Collections.ArrayList
        $percent = $null
        Write-ProgressFile $prog (@{ percent = 0; seconds = 0; line = 'DISM started' } | ConvertTo-Json -Compress)

        Dism.exe @dismArgs 2>&1 | ForEach-Object {
            $line = ([string]$_).Trim()
            if ($line -eq '') { return }
            [void]$tail.Add($line)
            if ($tail.Count -gt 6) { $tail.RemoveAt(0) }
            if ($line -match '(\d+(?:\.\d+)?)\s*%') {
                $script:percent = [double]$matches[1]
                Write-ProgressFile $prog (@{ percent = $script:percent; seconds = [int]$sw.Elapsed.TotalSeconds; line = $line } | ConvertTo-Json -Compress)
            }
        }

        $code = $LASTEXITCODE
        Write-ProgressFile $prog (@{ percent = 100; seconds = [int]$sw.Elapsed.TotalSeconds; line = 'exit ' + $code; done = $true } | ConvertTo-Json -Compress)
        $result.exitCode = [int]$code
        $result.percent = $percent
        $result.seconds = [int]$sw.Elapsed.TotalSeconds
        $result.tail = ($tail -join ' | ')
        if ($code -ne 0) {
            $result.ok = $false
            if ($code -eq 740) { $result.error = 'needs-admin' } else { $result.error = 'dism-exit-' + $code }
        }
    } else {
        $result.ok = $false
        $result.error = 'unknown-action'
    }
} catch {
    $result.ok = $false
    $result.error = [string]$_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 6 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
