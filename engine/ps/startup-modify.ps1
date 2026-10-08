param([string]$Payload, [string]$Out)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
if ($Payload -notmatch '^[A-Za-z]:\\') {
    . (Join-Path $PSScriptRoot 'secure-ipc.ps1')
    Initialize-SecureIpc | Out-Null
}

$result = [pscustomobject]@{ ok = $false; message = ''; backupFile = '' }

try {
    if ($Payload -match '^[A-Za-z]:\\') {
        $req = Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
        $req = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    }
    $it = $req.item
    if (-not $it) { throw 'missing item' }

    if ($req.action -eq 'disable') {
        if ($it.source -eq 'registry') {
            if (-not (Test-Path -LiteralPath $it.keyPath)) { throw ('key not found: ' + $it.keyPath) }
            Remove-ItemProperty -LiteralPath $it.keyPath -Name $it.name -ErrorAction Stop
            $result.message = 'registry value removed'
        } else {
            if (-not (Test-Path -LiteralPath $it.command)) { throw ('file not found: ' + $it.command) }
            if (-not (Test-Path -LiteralPath $req.backupDir)) {
                New-Item -ItemType Directory -Path $req.backupDir -Force | Out-Null
            }
            $dest = Join-Path $req.backupDir $it.name
            Move-Item -LiteralPath $it.command -Destination $dest -Force -ErrorAction Stop
            $result.backupFile = $dest
            $result.message = 'startup file moved to backup'
        }
    } elseif ($req.action -eq 'enable') {
        if ($it.source -eq 'registry') {
            if (-not (Test-Path -LiteralPath $it.keyPath)) {
                New-Item -Path $it.keyPath -Force | Out-Null
            }
            New-ItemProperty -LiteralPath $it.keyPath -Name $it.name -Value $it.command -PropertyType String -Force -ErrorAction Stop | Out-Null
            $result.message = 'registry value restored'
        } else {
            $src = $it.backupFile
            if (-not $src) { $src = Join-Path $req.backupDir $it.name }
            if (-not (Test-Path -LiteralPath $src)) { throw ('backup file missing: ' + $src) }
            $dest = Join-Path $it.keyPath $it.name
            Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop
            $result.message = 'startup file restored'
        }
    } else {
        throw ('unknown action: ' + $req.action)
    }
    $result.ok = $true
} catch {
    $result.ok = $false
    $result.message = $_.Exception.Message
}

$json = $result | ConvertTo-Json -Depth 3 -Compress
if ($Out) { [IO.File]::WriteAllText($Out, $json, (New-Object Text.UTF8Encoding $false)) }
else { Write-Output $json }
