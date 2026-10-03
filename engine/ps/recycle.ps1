$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$count = 0
try {
    $shell = New-Object -ComObject Shell.Application
    $items = @($shell.Namespace(10).Items())
    $count = $items.Count
} catch { }
$size = 0
try {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $p = Join-Path 'C:\$Recycle.Bin' $sid
    if (Test-Path -LiteralPath $p) {
        $m = Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
        if ($m.Sum) { $size = [int64]$m.Sum }
    }
} catch { }
@{ count = $count; size = $size } | ConvertTo-Json -Compress
