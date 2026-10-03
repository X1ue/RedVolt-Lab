$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$items = New-Object System.Collections.ArrayList

$regRoots = @(
    @{ Hive = 'HKCU'; Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; Admin = $false },
    @{ Hive = 'HKLM'; Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; Admin = $true },
    @{ Hive = 'HKCU'; Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce'; Admin = $false },
    @{ Hive = 'HKLM'; Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce'; Admin = $true }
)

$skip = @('PSPath', 'PSParentPath', 'PSChildName', 'PSDrive', 'PSProvider')

foreach ($r in $regRoots) {
    if (Test-Path -LiteralPath $r.Path) {
        $props = Get-ItemProperty -LiteralPath $r.Path
        foreach ($p in $props.PSObject.Properties) {
            if ($skip -contains $p.Name) { continue }
            [void]$items.Add([pscustomobject]@{
                source     = 'registry'
                hive       = $r.Hive
                keyPath    = $r.Path
                name       = [string]$p.Name
                command    = [string]$p.Value
                needsAdmin = $r.Admin
            })
        }
    }
}

$folders = @(
    @{ Path = [Environment]::GetFolderPath('Startup'); Admin = $false; Label = 'user' },
    @{ Path = [Environment]::GetFolderPath('CommonStartup'); Admin = $true; Label = 'common' }
)

foreach ($f in $folders) {
    if ($f.Path -and (Test-Path -LiteralPath $f.Path)) {
        $files = Get-ChildItem -LiteralPath $f.Path -Force -File
        foreach ($file in $files) {
            if ($file.Extension -ieq '.ini') { continue }
            [void]$items.Add([pscustomobject]@{
                source     = 'folder'
                hive       = $f.Label
                keyPath    = $f.Path
                name       = [string]$file.Name
                command    = [string]$file.FullName
                needsAdmin = $f.Admin
            })
        }
    }
}

@{ items = $items } | ConvertTo-Json -Depth 4 -Compress
