param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '..\engine\ps\secure-ipc.ps1')
Initialize-SecureIpc | Out-Null

# 提权进程拥有管理员权限，因此这里独立再做一次白名单校验（不信任调用方传入的路径）
$Allowed = @(
    (Join-Path $env:windir 'SoftwareDistribution\Download'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportQueue'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\WER\ReportArchive'),
    (Join-Path $env:windir 'Prefetch'),
    (Join-Path $env:windir 'Temp'),
    (Join-Path $env:windir 'Logs\CBS'),
    (Join-Path $env:windir 'ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache'),
    (Join-Path $env:SystemDrive 'Windows.old'),
    (Join-Path $env:SystemDrive '$WINDOWS.~BT')
)

function Test-Allowed([string]$Path) {
    if (-not $Path) { return $false }
    try { $norm = [IO.Path]::GetFullPath($Path).TrimEnd('\') }
    catch { return $false }
    foreach ($a in $Allowed) {
        try { $an = [IO.Path]::GetFullPath($a).TrimEnd('\') }
        catch { continue }
        if ($norm.Equals($an, [StringComparison]::OrdinalIgnoreCase)) { return $true }
        if ($norm.StartsWith($an + '\', [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function Get-DirStat([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $null }
    $files = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue)
    $size = [int64]0
    $last = $null
    foreach ($f in $files) {
        $size += $f.Length
        if (-not $last -or $f.LastWriteTime -gt $last) { $last = $f.LastWriteTime }
    }
    return [pscustomobject]@{ size = $size; count = $files.Count; last = $last }
}

function Remove-DirContents([string]$Path) {
    $deleted = 0
    $locked = 0
    $freed = [int64]0
    $entries = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)
    foreach ($e in $entries) {
        if ($e.Attributes -band [IO.FileAttributes]::ReparsePoint) { $locked++; continue }
        $before = 0
        if (-not $e.PSIsContainer) { $before = $e.Length }
        Remove-Item -LiteralPath $e.FullName -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $e.FullName) { $locked++ }
        else { $deleted++; $freed += $before }
    }
    return [pscustomobject]@{ deleted = $deleted; locked = $locked; freed = $freed }
}

$result = [pscustomobject]@{ ok = $true; message = ''; results = @() }

try {
    if ($Payload -match '^[A-Za-z]:\\') {
        $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
        $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    }
    $list = New-Object System.Collections.ArrayList

    foreach ($t in $req.targets) {
        if ($t.kind -eq 'flushDns') {
            if ($req.action -eq 'clean') {
                ipconfig /flushdns | Out-Null
                [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'done'; message = 'DNS cache flushed'; deleted = 1; locked = 0; freed = 0; size = 0; count = 0; last = $null })
            } else {
                [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'ok'; message = 'command action'; deleted = 0; locked = 0; freed = 0; size = 0; count = 0; last = $null })
            }
            continue
        }

        foreach ($p in $t.paths) {
            if (-not (Test-Allowed $p)) {
                [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'refused'; message = ('not in system whitelist: ' + $p); deleted = 0; locked = 0; freed = 0; size = 0; count = 0; last = $null })
                continue
            }
            if ($req.action -eq 'scan') {
                $s = Get-DirStat $p
                if ($null -eq $s) {
                    [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'missing'; message = 'missing or reparse point'; deleted = 0; locked = 0; freed = 0; size = 0; count = 0; last = $null })
                } else {
                    $lastText = $null
                    if ($s.last) { $lastText = $s.last.ToString('o') }
                    [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'ok'; message = ''; deleted = 0; locked = 0; freed = 0; size = $s.size; count = $s.count; last = $lastText })
                }
            } elseif ($req.action -eq 'clean') {
                $r = Remove-DirContents $p
                if ($t.kind -eq 'removeDirs') {
                    # Windows.old / $WINDOWS.~BT: the folder itself must go, not just its contents
                    Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
                    if (Test-Path -LiteralPath $p) { $r.locked = $r.locked + 1 } else { $r.deleted = $r.deleted + 1 }
                }
                [void]$list.Add([pscustomobject]@{ id = $t.id; status = 'done'; message = ''; deleted = $r.deleted; locked = $r.locked; freed = $r.freed; size = 0; count = 0; last = $null })
            }
        }
    }
    $result.results = $list
} catch {
    $result.ok = $false
    $result.message = $_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 5 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
