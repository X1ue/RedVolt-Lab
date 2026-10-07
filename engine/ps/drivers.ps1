param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# pnputil labels follow the OS UI language, so parse by position and by value shape
# instead of by label text. Field order inside a block is fixed across locales.
function Get-DriverPackages {
    $raw = (pnputil /enum-drivers 2>&1 | Out-String)
    $pkgs = @()
    foreach ($block in ($raw -split "(?m)^\s*$")) {
        $lines = @($block -split "\r?\n" | Where-Object { $_.Trim() -ne '' })
        if ($lines.Count -eq 0) { continue }
        $pub = $null; $orig = $null; $prov = $null; $cls = $null; $verDate = $null; $verNum = $null
        for ($i = 0; $i -lt $lines.Count; $i++) {
            if ($lines[$i] -match '(oem\d+\.inf)') {
                $pub = $matches[1]
                if ($i + 1 -lt $lines.Count) { $orig = (($lines[$i + 1] -split ':', 2)[-1]).Trim() }
                if ($i + 2 -lt $lines.Count) { $prov = (($lines[$i + 2] -split ':', 2)[-1]).Trim() }
                if ($i + 3 -lt $lines.Count) { $cls = (($lines[$i + 3] -split ':', 2)[-1]).Trim() }
                continue
            }
            if ($lines[$i] -match '(\d{1,2}/\d{1,2}/\d{4})\s+([\d\.]+)') {
                $verDate = $matches[1]; $verNum = $matches[2]
            }
        }
        if (-not $pub) { continue }
        $ticks = [int64]0
        if ($verDate) {
            try {
                $dt = [datetime]::ParseExact($verDate, 'MM/dd/yyyy', [Globalization.CultureInfo]::InvariantCulture)
                $ticks = $dt.Ticks
            } catch { $ticks = [int64]0 }
        }
        $pkgs += [pscustomobject]@{
            pub = $pub; orig = $orig; provider = $prov; class = $cls
            date = $verDate; version = $verNum; ticks = $ticks
        }
    }
    return $pkgs
}

# String compare would rank 1.0.0.9 above 1.0.0.11; always compare as [version].
function Get-VersionKey([string]$Text) {
    try { return [version]$Text } catch { return [version]'0.0' }
}

function Get-DuplicateGroups($Pkgs) {
    $groups = @()
    foreach ($g in ($Pkgs | Where-Object { $_.orig } | Group-Object { $_.orig.ToLower() })) {
        if ($g.Count -lt 2) { continue }
        $sorted = @($g.Group | Sort-Object @{ Expression = { $_.ticks } }, @{ Expression = { Get-VersionKey $_.version } })
        $newest = $sorted[-1]
        $old = @()
        foreach ($o in ($sorted | Select-Object -First ($sorted.Count - 1))) {
            $old += [pscustomobject]@{ pub = $o.pub; version = $o.version; date = $o.date }
        }
        $groups += [pscustomobject]@{
            orig = $g.Group[0].orig; provider = $newest.provider; class = $newest.class
            keep = [pscustomobject]@{ pub = $newest.pub; version = $newest.version; date = $newest.date }
            old = $old
        }
    }
    return $groups
}

# hashtable, not pscustomobject: the result shape differs per action and a pscustomobject rejects new keys
$result = @{ ok = $true; error = ''; action = '' }

try {
    $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    $result.action = [string]$req.action

    if ($req.action -eq 'list') {
        $pkgs = @(Get-DriverPackages)
        $groups = @(Get-DuplicateGroups $pkgs)
        $oldCount = 0
        foreach ($g in $groups) { $oldCount += @($g.old).Count }
        $result.total = $pkgs.Count
        $result.groups = $groups
        $result.oldCount = $oldCount
        if ($pkgs.Count -eq 0) { $result.ok = $false; $result.error = 'pnputil-no-packages' }
    } elseif ($req.action -eq 'delete') {
        # Re-derive the keep set right now: the UI snapshot may be stale after a driver update.
        $pkgs = @(Get-DriverPackages)
        $groups = @(Get-DuplicateGroups $pkgs)
        $keepSet = @{}
        $known = @{}
        foreach ($g in $groups) { $keepSet[$g.keep.pub.ToLower()] = $true }
        foreach ($p in $pkgs) { $known[$p.pub.ToLower()] = $true }

        $out = @()
        foreach ($raw in @($req.pubs)) {
            $pub = [string]$raw
            if ($pub -notmatch '^oem\d+\.inf$') {
                $out += [pscustomobject]@{ pub = $pub; deleted = $false; code = 'bad-name' }; continue
            }
            $key = $pub.ToLower()
            if (-not $known.ContainsKey($key)) {
                $out += [pscustomobject]@{ pub = $pub; deleted = $false; code = 'not-found' }; continue
            }
            if ($keepSet.ContainsKey($key)) {
                $out += [pscustomobject]@{ pub = $pub; deleted = $false; code = 'is-newest' }; continue
            }
            # No /uninstall and no /force: pnputil must refuse anything a device still depends on.
            $txt = (pnputil /delete-driver $pub 2>&1 | Out-String)
            $gone = $true
            foreach ($p in @(Get-DriverPackages)) { if ($p.pub.ToLower() -eq $key) { $gone = $false; break } }
            $tail = ($txt -split "\r?\n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
            if ($gone) { $out += [pscustomobject]@{ pub = $pub; deleted = $true; code = ''; detail = [string]$tail } }
            else { $out += [pscustomobject]@{ pub = $pub; deleted = $false; code = 'in-use'; detail = [string]$tail } }
        }
        $result.results = $out
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
