param([int]$SelfPid = 0)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Working-set trim only: no process is ever killed. Critical system processes, this app,
# and a foreground fullscreen window (a running game) are left untouched.
$src = @'
using System;
using System.Runtime.InteropServices;
public static class MemWin {
    [DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

$Protected = @(
    'system', 'idle', 'registry', 'memory compression', 'smss', 'csrss', 'wininit', 'winlogon',
    'services', 'lsass', 'fontdrvhost', 'dwm', 'explorer', 'audiodg', 'svchost', 'wmiprvse',
    'searchhost', 'runtimebroker', 'shellexperiencehost', 'startmenuexperiencehost',
    'applicationframehost', 'sihost', 'taskhostw', 'ctfloader', 'textinputhost', 'shellhost',
    'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'msdtc',
    'nvcontainer', 'nvdisplay.container', 'nvsphelper64', 'nvbackend',
    'gamebar', 'gamebarftserver', 'gameinput', 'windows terminal', 'windowsterminal',
    'conhost', 'powershell', 'pwsh', 'cmd', 'electron', 'systemsettings'
)

$selfPath = $null
if ($SelfPid -gt 0) {
    $sp = Get-Process -Id $SelfPid -ErrorAction SilentlyContinue
    if ($sp) { $selfPath = $sp.Path }
}

$fgPid = 0
$fg = [MemWin]::GetForegroundWindow()
if ($fg -ne [IntPtr]::Zero) {
    $rect = New-Object 'MemWin+RECT'
    if ([MemWin]::GetWindowRect($fg, [ref]$rect)) {
        $sw = [MemWin]::GetSystemMetrics(0)
        $sh = [MemWin]::GetSystemMetrics(1)
        if ((($rect.Right - $rect.Left) -ge $sw) -and (($rect.Bottom - $rect.Top) -ge $sh)) {
            foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
                if ($p.MainWindowHandle -eq $fg) { $fgPid = $p.Id; break }
            }
        }
    }
}

$targets = @()
$skipped = 0
$before = [int64]0
foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
    if ($SelfPid -gt 0 -and $p.Id -eq $SelfPid) { continue }
    if ($selfPath -and $p.Path -eq $selfPath) { continue }
    if ($fgPid -gt 0 -and $p.Id -eq $fgPid) { $skipped++; continue }
    $n = [string]$p.ProcessName
    if ($Protected -contains $n.ToLower()) { $skipped++; continue }
    $ws = [int64]$p.WorkingSet64
    if ($ws -lt 20971520) { $skipped++; continue }
    $targets += $p
    $before += $ws
}

$done = 0
$failed = 0
foreach ($p in $targets) {
    try {
        if ([MemWin]::EmptyWorkingSet($p.Handle)) { $done++ } else { $failed++ }
    } catch { $failed++ }
}

Start-Sleep -Milliseconds 900

$after = [int64]0
foreach ($p in $targets) {
    try { $p.Refresh(); $after += [int64]$p.WorkingSet64 } catch { }
}

$os = Get-CimInstance Win32_OperatingSystem
$result = @{
    ok             = $true
    trimmed        = $done
    failed         = $failed
    skipped        = $skipped
    foregroundPid  = $fgPid
    beforeBytes    = $before
    afterBytes     = $after
    freedBytes     = ($before - $after)
    freePhysBytes  = [int64]$os.FreePhysicalMemory * 1024
    totalPhysBytes = [int64]$os.TotalVisibleMemorySize * 1024
}

Write-Output ($result | ConvertTo-Json -Compress)
