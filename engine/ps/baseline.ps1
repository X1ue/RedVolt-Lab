param([string]$Payload, [string]$Out)
# Elevated only: run the built-in WinSAT 4K random-read test and hand back whatever
# the tool itself reported. We never invent a number when the test cannot run.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$result = @{
    ok        = $true
    error     = ''
    action    = ''
    drive     = ''
    seconds   = 0
    exitCode  = $null
    file      = ''
    fileTime  = ''
    values    = @()
    raw       = ''
}

try {
    $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    $result.action = [string]$req.action

    if ($req.action -eq 'bench') {
        $drive = (([string]$req.drive) -replace '[^A-Za-z]', '')
        if (-not $drive) { $drive = 'C' }
        $drive = $drive.Substring(0, 1).ToUpper()
        $result.drive = $drive

        $exe = Join-Path $env:SystemRoot 'System32\winsat.exe'
        $store = Join-Path $env:SystemRoot 'Performance\WinSAT\DataStore'
        if (-not (Test-Path -LiteralPath $exe)) {
            $result.ok = $false
            $result.error = 'no-winsat'
        } elseif (-not (Test-Path -LiteralPath $store)) {
            $result.ok = $false
            $result.error = 'no-datastore'
        } else {
            $stamp = Get-Date
            $prev = @(Get-ChildItem -LiteralPath $store -Filter *.xml -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1)
            if ($prev.Count -eq 1) { $stamp = $prev[0].LastWriteTime }

            $sw = [Diagnostics.Stopwatch]::StartNew()
            $raw = (& $exe disk -drive $drive -ran -read -rand 4k 2>&1 | Out-String)
            $code = $LASTEXITCODE
            $sw.Stop()

            $result.seconds = [int]$sw.Elapsed.TotalSeconds
            $result.exitCode = [int]$code
            $result.raw = ($raw -replace '\s+', ' ').Trim()
            if ($result.raw.Length -gt 400) { $result.raw = $result.raw.Substring(0, 400) }

            if ($code -eq 740) {
                $result.ok = $false
                $result.error = 'needs-admin'
            } elseif ($code -ne 0) {
                $result.ok = $false
                $result.error = 'winsat-exit-' + $code
            }

            # WinSAT only writes its own report; read the freshest one instead of parsing stdout.
            $fresh = @(Get-ChildItem -LiteralPath $store -Filter *.xml -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -gt $stamp } |
                Sort-Object LastWriteTime -Descending)
            $picked = $null
            foreach ($f in $fresh) {
                $vals = @()
                try {
                    $x = [xml](Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8)
                    $nodes = @($x.SelectNodes('//Disk/*'))
                    if ($nodes.Count -eq 0) { $nodes = @($x.SelectNodes('//*')) }
                    foreach ($n in $nodes) {
                        $txt = ([string]$n.InnerText).Trim()
                        if ($txt -notmatch '^[\d]+([.][\d]+)?$') { continue }
                        if ($n.Name -notmatch 'Disk') { continue }
                        $u = ([string]$n.GetAttribute('units'))
                        $vals += @{ name = [string]$n.Name; value = [double]$txt; units = $u }
                    }
                } catch { $vals = @() }
                if ($vals.Count -gt 0) { $picked = $f; $result.values = $vals; break }
            }
            if ($picked) {
                $result.file = $picked.Name
                $result.fileTime = $picked.LastWriteTime.ToString('o')
            } elseif ($code -eq 0) {
                $result.ok = $false
                $result.error = 'no-report'
            }
            if ($result.values.Count -gt 24) { $result.values = @($result.values | Select-Object -First 24) }
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
