param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Deep, read-only health facts. Everything here needs administrator rights, so it runs in a
# single elevated pass (one UAC prompt) instead of several separate ones.

function To-Bytes([double]$n, [string]$unit) {
    switch ($unit.ToUpper()) {
        'TB' { return [int64]($n * 1024 * 1024 * 1024 * 1024) }
        'GB' { return [int64]($n * 1024 * 1024 * 1024) }
        'MB' { return [int64]($n * 1024 * 1024) }
        'KB' { return [int64]($n * 1024) }
        default { return [int64]$n }
    }
}

function Size-Of([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $sum = [int64]0
    foreach ($f in (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue)) { $sum += $f.Length }
    return $sum
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
    if ($list.Count -ge 3) { return @{ used = $list[0]; allocated = $list[1]; max = $list[2] } }
    Add-Fail 'shadow-storage' 'vssadmin-no-numbers'
    return $null
}

function Get-RestoreFacts {
    # duplicated from restorepoint.ps1 on purpose: one UAC prompt must cover the whole deep scan
    $points = $null
    try { $points = @(Get-ComputerRestorePoint -ErrorAction Stop) }
    catch { Add-Fail 'restore-points' (Fail-Reason $_) }
    # unreadable must not be reported as "you have zero restore points"
    if ($null -eq $points) { return @{ readable = $false; count = $null; last = $null; disabled = $null; shadow = $null } }
    $last = $null
    if ($points.Count -gt 0) {
        $p = $points | Sort-Object SequenceNumber | Select-Object -Last 1
        $t = $null
        try { $t = ([datetime]$p.CreationTime).ToString('o') } catch { $t = [string]$p.CreationTime }
        $last = @{ seq = [int]$p.SequenceNumber; description = [string]$p.Description; at = $t }
    }
    $disabled = $null
    try {
        $cfg = Get-CimInstance -Namespace root\default -Class SystemRestoreConfig -ErrorAction Stop
        if ($cfg) { $disabled = [bool]$cfg.DisableSR }
    } catch { Add-Fail 'restore-config' (Fail-Reason $_) }
    return @{ readable = $true; count = $points.Count; last = $last; disabled = $disabled; shadow = (Get-ShadowStorage) }
}

$result = @{ ok = $true; error = ''; failed = @() }

# Each section is isolated: one denied API (e.g. the boot diagnostics log) must not
# throw away the five other sections that did succeed.
function Add-Fail([string]$Section, [string]$Msg) {
    $script:result.failed += @{ section = $Section; error = $Msg }
}

# Exception messages are localized, so reduce the common cases to stable ASCII codes
# that the JS side can turn into proper wording.
function Fail-Reason($Err) {
    $id = [string]$Err.FullyQualifiedErrorId
    $msg = [string]$Err.Exception.Message
    if ($id -like '*UnauthorizedAccess*' -or $msg -match '(?i)access is denied|access denied|unauthorized') { return 'access-denied' }
    if ($id -like 'NoMatchingLogsFound*') { return 'log-absent' }
    if ($id -like 'NoMatchingEventsFound*') { return 'no-events' }
    if ($msg.Length -gt 160) { return $msg.Substring(0, 160) }
    return $msg
}

function Invoke-Section([string]$Name, [scriptblock]$Body) {
    try { & $Body } catch { Add-Fail $Name (Fail-Reason $_) }
}

# Get-WinEvent throws for three very different reasons: no matching events (a real answer),
# no such log, and access denied. Only the last two mean we could not read anything.
function Read-Events($Filter, [string]$LogName, [int]$Max, [string]$Section) {
    try {
        if ($LogName) { return @{ events = @(Get-WinEvent -LogName $LogName -MaxEvents $Max -ErrorAction Stop); denied = $false } }
        return @{ events = @(Get-WinEvent -FilterHashtable $Filter -MaxEvents $Max -ErrorAction Stop); denied = $false }
    } catch {
        $id = [string]$_.FullyQualifiedErrorId
        if ($id -like 'NoMatchingEventsFound*') { return @{ events = @(); denied = $false } }
        if ($id -like 'NoMatchingLogsFound*') { Add-Fail $Section 'log-absent'; return @{ events = @(); denied = $true } }
        Add-Fail $Section 'access-denied'
        return @{ events = @(); denied = $true }
    }
}

function Dism-Size([string]$Raw, [string]$Label) {
    $m = [regex]::Match($Raw, [regex]::Escape($Label) + '\s*:\s*([\d]+(?:\.[\d]+)?)\s*(TB|GB|MB|KB|bytes)')
    if ($m.Success) { return (To-Bytes ([double]$m.Groups[1].Value) $m.Groups[2].Value) }
    return $null
}

Invoke-Section 'admin' {
    $script:result.admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ---- 1. component store (WinSxS) ----
Invoke-Section 'winsxs' {
    $dismRaw = (Dism.exe /Online /Cleanup-Image /AnalyzeComponentStore /English 2>&1 | Out-String)
    $d = @{ ok = $false }
    $d.reported = Dism-Size $dismRaw 'Windows Explorer Reported Size of Component Store'
    $d.actual = Dism-Size $dismRaw 'Actual Size of Component Store'
    $d.shared = Dism-Size $dismRaw 'Shared with Windows'
    $d.backups = Dism-Size $dismRaw 'Backups and Disabled Features'
    $d.cachetemp = Dism-Size $dismRaw 'Cache and Temporary Data'
    $mLast = [regex]::Match($dismRaw, 'Date of Last Cleanup\s*:\s*(.+)')
    if ($mLast.Success) { $d.lastCleanup = $mLast.Groups[1].Value.Trim() }
    $mRec = [regex]::Match($dismRaw, 'Number of Reclaimable Packages\s*:\s*(\d+)')
    if ($mRec.Success) { $d.reclaimable = [int]$mRec.Groups[1].Value }
    $mSug = [regex]::Match($dismRaw, 'Component Store Cleanup Recommended\s*:\s*(\w+)')
    if ($mSug.Success) { $d.recommended = ($mSug.Groups[1].Value.ToLower() -eq 'yes') }
    if ($null -ne $d.actual) {
        $d.ok = $true
    } else {
        $d.raw = $dismRaw.Substring(0, [Math]::Min(600, $dismRaw.Length))
        # DISM error 740 means "needs elevation"; say so instead of blaming a corrupt store
        if ($dismRaw -match 'Error:\s*740') { $d.needsAdmin = $true }
    }
    $script:result.winsxs = $d
}

# ---- 2. TRIM ----
Invoke-Section 'trim' {
    $trimRaw = (fsutil behavior query DisableDeleteNotify 2>&1 | Out-String)
    $trim = @()
    foreach ($m in [regex]::Matches($trimRaw, '(NTFS|ReFS)\s+DisableDeleteNotify\s*=\s*(\d+)')) {
        $trim += @{ fs = $m.Groups[1].Value; disabled = ([int]$m.Groups[2].Value -ne 0) }
    }
    if ($trim.Count -eq 0) { Add-Fail 'trim' 'fsutil-no-output' }
    $script:result.trim = $trim
}

# ---- 3. restore points ----
Invoke-Section 'restore' { $script:result.restore = Get-RestoreFacts }

# ---- 4. space that Windows itself holds ----
Invoke-Section 'leftovers' {
    $left = @()
    $paths = @(
        'C:\Windows\SoftwareDistribution\Download',
        'C:\Windows\SoftwareDistribution\DataStore',
        'C:\Windows\Temp',
        'C:\Windows\Logs\CBS',
        'C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache',
        'C:\Windows.old',
        'C:\$WINDOWS.~BT',
        'C:\Windows\Prefetch'
    )
    foreach ($p in $paths) {
        $s = Size-Of $p
        if ($null -ne $s) { $left += @{ path = $p; bytes = $s; exists = $true } }
        else { $left += @{ path = $p; bytes = 0; exists = $false } }
    }
    $script:result.leftovers = $left
}

# ---- 5. third-party driver store ----
Invoke-Section 'drivers' {
    $pnRaw = (pnputil /enum-drivers 2>&1 | Out-String)
    $drivers = @()
    foreach ($block in ($pnRaw -split "(?m)^\s*$")) {
        $lines = @($block -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
        if ($lines.Count -eq 0) { continue }
        $pub = $null; $orig = $null; $prov = $null; $verDate = $null; $verNum = $null
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '(oem\d+\.inf)') {
                $pub = $matches[1]
                if ($i + 1 -lt $lines.Count) { $orig = (($lines[$i + 1] -split ':', 2)[-1]).Trim() }
                if ($i + 2 -lt $lines.Count) { $prov = (($lines[$i + 2] -split ':', 2)[-1]).Trim() }
                continue
            }
            if ($lines[$i] -match '(\d{2}/\d{2}/\d{4})\s+([\d\.]+)') {
                $verDate = $matches[1]; $verNum = $matches[2]
            }
        }
        if ($pub) {
            $ticks = $null
            if ($verDate) {
                try {
                    $dt = [datetime]::ParseExact($verDate, 'MM/dd/yyyy', [Globalization.CultureInfo]::InvariantCulture)
                    $ticks = $dt.Ticks
                } catch { $ticks = $null }
            }
            $drivers += @{ pub = $pub; orig = $orig; provider = $prov; date = $verDate; version = $verNum; ticks = $ticks }
        }
    }
    if ($drivers.Count -eq 0) { Add-Fail 'drivers' 'pnputil-no-packages' }
    $script:result.driverCount = $drivers.Count
    $dupeGroups = @()
    foreach ($g in ($drivers | Where-Object { $_.orig } | Group-Object { $_.orig.ToLower() })) {
        if ($g.Count -lt 2) { continue }
        # same ranking rule as drivers.ps1 (Windows ranks by date first, then version);
        # a plain string compare would rank 1.0.0.9 above 1.0.0.11
        $sorted = @($g.Group | Sort-Object @{ Expression = { if ($_.ticks) { $_.ticks } else { 0 } } }, @{ Expression = { try { [version]$_.version } catch { [version]'0.0' } } })
        $newest = $sorted[-1]
        $old = @()
        foreach ($o in ($sorted | Select-Object -First ($sorted.Count - 1))) { $old += $o.pub }
        $dupeGroups += @{ orig = $g.Group[0].orig; provider = $newest.provider; keep = $newest.pub; keepVersion = $newest.version; keepDate = $newest.date; old = $old }
    }
    $script:result.driverDuplicates = $dupeGroups
}

# ---- 6. boot timing evidence ----
Invoke-Section 'boot' {
    $boot = @{
        dpsEvents = $false; events = @(); lastBoots = @(); unexpectedShutdowns = $null
        readable  = @{ perf = $false; kernel = $false; crash = $false }
    }
    $perf = Read-Events $null 'Microsoft-Windows-Diagnostics-Performance/Operational' 80 'boot-perf'
    $boot.readable.perf = -not $perf.denied
    foreach ($e in ($perf.events | Where-Object { $_.Id -in 100, 101, 114 } | Select-Object -First 6)) {
        $pairs = @()
        $x = [xml]$e.ToXml()
        foreach ($dn in $x.Event.EventData.Data) { $pairs += @{ n = [string]$dn.Name; v = [string]$dn.InnerText } }
        $boot.events += @{ id = [int]$e.Id; at = $e.TimeCreated.ToString('o'); data = $pairs }
    }
    if (@($perf.events | Where-Object { $_.Id -eq 100 }).Count -gt 0) { $boot.dpsEvents = $true }

    $kb = Read-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Boot'; Id = 27 } $null 6 'boot-kernel'
    $boot.readable.kernel = -not $kb.denied
    foreach ($e in $kb.events) {
        $x = [xml]$e.ToXml()
        $bt = $null
        foreach ($dn in $x.Event.EventData.Data) { if ([string]$dn.Name -eq 'BootType') { $bt = [string]$dn.InnerText } }
        $boot.lastBoots += @{ at = $e.TimeCreated.ToString('o'); bootType = $bt }
    }

    $crash = Read-Events @{ LogName = 'System'; Id = 6008; StartTime = (Get-Date).AddDays(-30) } $null 20 'boot-crash'
    $boot.readable.crash = -not $crash.denied
    # "no matching events" is a real answer (zero unexpected shutdowns), not a failure
    if (-not $crash.denied) { $boot.unexpectedShutdowns = $crash.events.Count }
    $script:result.boot = $boot
}

if ($result.failed.Count -gt 0 -and $null -eq $result.boot -and $null -eq $result.winsxs) { $result.ok = $false }

$json = $result | ConvertTo-Json -Depth 6 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
