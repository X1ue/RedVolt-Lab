param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot 'secure-ipc.ps1')
Initialize-SecureIpc | Out-Null

# Read-only status + one explicit create action. Nothing else in this script writes to the system.

function To-Bytes([double]$n, [string]$unit) {
    switch ($unit.ToUpper()) {
        'TB' { return [int64]($n * 1024 * 1024 * 1024 * 1024) }
        'GB' { return [int64]($n * 1024 * 1024 * 1024) }
        'MB' { return [int64]($n * 1024 * 1024) }
        'KB' { return [int64]($n * 1024) }
        default { return [int64]$n }
    }
}

# vssadmin prints localized labels, so match the numbers instead of the words
function Get-ShadowStorage {
    $raw = (vssadmin list shadowstorage 2>&1 | Out-String)
    $found = [regex]::Matches($raw, '([\d]+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|bytes)')
    $list = @()
    foreach ($m in $found) {
        $val = [double]($m.Groups[1].Value -replace ',', '.')
        $list += (To-Bytes $val $m.Groups[2].Value)
    }
    if ($list.Count -ge 3) {
        return @{ used = $list[0]; allocated = $list[1]; max = $list[2] }
    }
    return $null
}

function Get-RestoreFacts {
    $points = @(Get-ComputerRestorePoint)
    $last = $null
    if ($points.Count -gt 0) {
        $p = $points | Sort-Object SequenceNumber | Select-Object -Last 1
        $t = $null
        try { $t = ([datetime]$p.CreationTime).ToString('o') } catch { $t = [string]$p.CreationTime }
        $last = @{ seq = [int]$p.SequenceNumber; description = [string]$p.Description; type = [int]$p.RestorePointType; at = $t }
    }
    $cfg = Get-CimInstance -Namespace root\default -Class SystemRestoreConfig
    $svc = @{}
    foreach ($n in @('SDRSVC', 'VSS')) {
        $s = Get-Service -Name $n
        if ($s) { $svc[$n] = [string]$s.Status } else { $svc[$n] = 'absent' }
    }
    return @{
        count     = $points.Count
        last      = $last
        disabled  = [bool]$cfg.DisableSR
        interval  = $cfg.RPSessionInterval
        shadow    = (Get-ShadowStorage)
        services  = $svc
        cmdlet    = [bool](Get-Command Checkpoint-Computer -ErrorAction SilentlyContinue)
    }
}

$result = @{ ok = $true; action = ''; error = ''; code = '' }

try {
    $req = $null
    if ($Payload) {
        if ($Payload -match '^[A-Za-z]:\\') {
            $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
        } else {
            $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
        }
    }
    $action = 'status'
    if ($req -and $req.action) { $action = [string]$req.action }
    $result.action = $action

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $result.admin = $isAdmin

    if ($action -eq 'status') {
        if (-not $isAdmin) {
            $result.ok = $false
            $result.code = 'needs-admin'
            $result.error = 'reading restore points requires administrator rights'
        } else {
            $f = Get-RestoreFacts
            $result.count = $f.count
            $result.last = $f.last
            $result.disabled = $f.disabled
            $result.interval = $f.interval
            $result.shadow = $f.shadow
            $result.services = $f.services
            $result.cmdlet = $f.cmdlet
        }
    }
    elseif ($action -eq 'create') {
        if (-not $isAdmin) {
            $result.ok = $false
            $result.code = 'needs-admin'
            $result.error = 'creating a restore point requires administrator rights'
        } else {
            $desc = 'RedVolt Lab'
            if ($req -and $req.description) { $desc = [string]$req.description }
            if ($desc.Length -gt 64) { $desc = $desc.Substring(0, 64) }
            $before = @(Get-ComputerRestorePoint).Count
            $t0 = Get-Date
            try {
                Checkpoint-Computer -Description $desc -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
                $after = @(Get-ComputerRestorePoint)
                $result.created = ($after.Count -gt $before)
                $result.count = $after.Count
                $result.elapsedMs = [int]((Get-Date) - $t0).TotalMilliseconds
                if (-not $result.created) {
                    $result.ok = $false
                    $result.code = 'no-new-point'
                    $result.error = 'Checkpoint-Computer returned without error but no new restore point appeared'
                }
            } catch {
                $msg = [string]$_.Exception.Message
                $result.ok = $false
                $result.error = $msg
                $result.code = 'error'
                if ($msg -match '24|interval|frequency|already been created') { $result.code = 'interval' }
                elseif ($msg -match 'disabled|not enabled|turn on') { $result.code = 'disabled' }
                elseif ($msg -match 'space|full|quota') { $result.code = 'no-space' }
            }
            $f = Get-RestoreFacts
            $result.last = $f.last
            $result.shadow = $f.shadow
        }
    }
    else {
        $result.ok = $false
        $result.code = 'bad-action'
        $result.error = 'unknown action'
    }
} catch {
    $result.ok = $false
    $result.code = 'error'
    $result.error = [string]$_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 5 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
