param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Payload -and $Payload -notmatch '^[A-Za-z]:\\') {
    . (Join-Path $PSScriptRoot 'secure-ipc.ps1')
    Initialize-SecureIpc | Out-Null
}

# Only these registry values may ever be read or written. The elevated run re-checks
# this table, so a tampered payload cannot reach any other key.
$Table = @(
    @{ id = 'hags';            hive = 'HKLM'; path = 'SYSTEM\CurrentControlSet\Control\GraphicsDrivers';                 name = 'HwSchMode' },
    @{ id = 'gamedvr_store';   hive = 'HKCU'; path = 'System\GameConfigStore';                                           name = 'GameDVR_Enabled' },
    @{ id = 'gamedvr_capture'; hive = 'HKCU'; path = 'SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR';                 name = 'AppCaptureEnabled' },
    @{ id = 'gamebar_nexus';   hive = 'HKCU'; path = 'Software\Microsoft\GameBar';                                       name = 'UseNexusForGameBarEnabled' },
    @{ id = 'gamebar_startup'; hive = 'HKCU'; path = 'Software\Microsoft\GameBar';                                       name = 'ShowStartupPanel' },
    @{ id = 'gamemode_auto';   hive = 'HKCU'; path = 'Software\Microsoft\GameBar';                                       name = 'AutoGameModeEnabled' },
    @{ id = 'transparency';    hive = 'HKCU'; path = 'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize';     name = 'EnableTransparency' },
    @{ id = 'visualfx';        hive = 'HKCU'; path = 'Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects'; name = 'VisualFXSetting' }
)

function Find-Entry([string]$Id) {
    foreach ($e in $Table) { if ($e.id -eq $Id) { return $e } }
    return $null
}

function Read-Entry($e) {
    $key = $e.hive + ':\' + $e.path
    $item = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
    if ($null -eq $item) { return @{ id = $e.id; keyExists = $false; exists = $false; value = $null } }
    $names = @($item.GetValueNames())
    if ($names -notcontains $e.name) { return @{ id = $e.id; keyExists = $true; exists = $false; value = $null } }
    $v = $item.GetValue($e.name)
    $num = $null
    if ($v -is [int] -or $v -is [long] -or $v -is [uint32] -or $v -is [int64]) { $num = [int64]$v }
    else { $parsed = 0; if ([long]::TryParse([string]$v, [ref]$parsed)) { $num = $parsed } }
    return @{ id = $e.id; keyExists = $true; exists = $true; value = $num }
}

function Write-Entry($e, [string]$Op, $Value) {
    $key = $e.hive + ':\' + $e.path
    if ($Op -eq 'del') {
        $item = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
        if ($null -eq $item) { return }
        if (@($item.GetValueNames()) -notcontains $e.name) { return }
        Remove-ItemProperty -LiteralPath $key -Name $e.name -Force -ErrorAction Stop
        return
    }
    $num = [int64]$Value
    if ($num -lt -2147483648 -or $num -gt 4294967295) { throw 'value out of range' }
    if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force -ErrorAction Stop | Out-Null }
    New-ItemProperty -LiteralPath $key -Name $e.name -Value ([int32]([uint32]$num)) -PropertyType DWord -Force -ErrorAction Stop | Out-Null
}

$isAdmin = $false
try {
    $pr = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    $isAdmin = $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch { $isAdmin = $false }

$payloadObj = $null
if ($Payload -and $Payload -match '^[A-Za-z]:\\') {
    $payloadObj = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
} elseif ($Payload) {
    $payloadObj = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
}
$action = 'read'
if ($payloadObj -and $payloadObj.action) { $action = [string]$payloadObj.action }

$result = @{ ok = $true; admin = $isAdmin; values = @(); results = @() }

try {
    if ($action -eq 'read') {
        foreach ($e in $Table) { $result.values += (Read-Entry $e) }
    }
    elseif ($action -eq 'write') {
        $ops = @()
        if ($payloadObj -and $payloadObj.ops) { $ops = @($payloadObj.ops) }
        foreach ($op in $ops) {
            $id = [string]$op.id
            $mode = [string]$op.op
            $e = Find-Entry $id
            if ($null -eq $e) { $result.results += @{ id = $id; ok = $false; error = 'not-whitelisted' }; continue }
            if ($mode -ne 'set' -and $mode -ne 'del') { $result.results += @{ id = $id; ok = $false; error = 'bad-op' }; continue }
            if ($e.hive -eq 'HKLM' -and -not $isAdmin) { $result.results += @{ id = $id; ok = $false; error = 'needs-admin' }; continue }
            try {
                Write-Entry $e $mode $op.value
                $result.results += @{ id = $id; ok = $true }
            } catch {
                $result.results += @{ id = $id; ok = $false; error = $_.Exception.Message }
            }
        }
        foreach ($e in $Table) { $result.values += (Read-Entry $e) }
        foreach ($r in $result.results) { if (-not $r.ok) { $result.ok = $false } }
    }
    else { $result.ok = $false; $result.error = 'bad-action' }
} catch {
    $result.ok = $false
    $result.error = $_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 5 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
