$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Read-only facts for the health report. No writes, no elevation required.
# All labels stay ASCII; the Chinese wording is produced on the JS side.

function Reg-Num([string]$Path, [string]$Name) {
    $v = (Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue).$Name
    if ($null -eq $v) { return $null }
    return $v
}

$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem

$result = @{ ok = $true }

$result.os = @{
    caption   = [string]$os.Caption
    build     = [string]$os.BuildNumber
    version   = [string]$os.Version
    arch      = [string]$os.OSArchitecture
    lastBoot  = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('o') } else { $null }
    uptimeSec = if ($os.LastBootUpTime) { [int]((Get-Date) - $os.LastBootUpTime).TotalSeconds } else { $null }
    ramTotal  = [int64]$os.TotalVisibleMemorySize * 1024
    ramFree   = [int64]$os.FreePhysicalMemory * 1024
    manufacturer = [string]$cs.Manufacturer
    model     = [string]$cs.Model
}

$result.disks = @()
foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    $result.disks += @{ letter = [string]$d.DeviceID; free = [int64]$d.FreeSpace; size = [int64]$d.Size; fs = [string]$d.FileSystem }
}

$result.physical = @()
$allParts = @(Get-Partition)
foreach ($p in (Get-PhysicalDisk)) {
    # Get-PhysicalDisk exposes DeviceId, not DeviceNumber; matching on the wrong
    # property silently yields zero drive letters and hides the shared-disk fact.
    $dn = if ($p.DeviceNumber -ne $null) { $p.DeviceNumber } else { $p.DeviceId }
    $letters = @()
    foreach ($pt in $allParts) {
        if ($pt.DiskNumber -eq $dn -and $pt.DriveLetter) { $letters += [string]$pt.DriveLetter }
    }
    $result.physical += @{
        name      = [string]$p.FriendlyName
        media     = [string]$p.MediaType
        bus       = [string]$p.BusType
        health    = [string]$p.HealthStatus
        size      = [int64]$p.Size
        diskNum   = [int]$dn
        letters   = $letters
    }
}

$result.pagefiles = @()
foreach ($f in (Get-CimInstance Win32_PageFileUsage)) {
    $result.pagefiles += @{ name = [string]$f.Name; allocatedMB = [int]$f.AllocatedBaseSize; usedMB = [int]$f.CurrentUsage }
}
$csAuto = (Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile
$result.pagefileAuto = [bool]$csAuto

$result.hibernate = @{
    hiberfilExists = [bool](Test-Path 'C:\hiberfil.sys')
    hiberboot      = Reg-Num 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' 'HiberbootEnabled'
    hibernateOn    = Reg-Num 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' 'HibernateEnabled'
}

$result.tweaks = @{
    hags        = Reg-Num 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' 'HwSchMode'
    gamedvr     = Reg-Num 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled'
    appCapture  = Reg-Num 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled'
    gamedvrPol  = Reg-Num 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR' 'AllowGameDVR'
    gameMode    = Reg-Num 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled'
    visualfx    = Reg-Num 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' 'VisualFXSetting'
    transparency = Reg-Num 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' 'EnableTransparency'
}

$result.startup = @{
    hkcRun = @((Get-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run').Property).Count
    hklmRun = @((Get-Item 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run').Property).Count
}

$result.services = @()
foreach ($n in @('DPS', 'DiagTrack', 'VSS', 'SDRSVC', 'wuauserv', 'BITS', 'SysMain', 'WSearch', 'WinDefend')) {
    $s = Get-Service -Name $n -ErrorAction SilentlyContinue
    if ($s) {
        $result.services += @{ name = [string]$s.Name; status = [string]$s.Status; startType = [string]$s.StartType }
    } else {
        $result.services += @{ name = $n; status = 'absent'; startType = 'absent' }
    }
}

$result.defender = @{ present = $false }
$mp = Get-MpComputerStatus
if ($mp) {
    $result.defender = @{
        present   = $true
        realtime  = [bool]$mp.RealTimeProtectionEnabled
        antivirus = [bool]$mp.AntivirusEnabled
        tamper    = [bool]$mp.IsTamperProtected
        signatureAgeHours = if ($mp.AntivirusSignatureAge) { [int]$mp.AntivirusSignatureAge.TotalHours } else { $null }
    }
}

$result.gpus = @()
foreach ($g in (Get-CimInstance Win32_VideoController)) {
    $pnp = [string]$g.PNPDeviceID
    $virtual = $pnp.StartsWith('ROOT\') -or ($g.Name -match '(?i)virtual|todesk|parsec|sunshine|idd|indirect|remote')
    $result.gpus += @{
        name       = [string]$g.Name
        driver     = [string]$g.DriverVersion
        driverDate = if ($g.DriverDate) { $g.DriverDate.ToString('o') } else { $null }
        pnp        = $pnp
        virtual    = [bool]$virtual
        refresh    = [int]$g.CurrentRefreshRate
        width      = [int]$g.CurrentHorizontalResolution
        height     = [int]$g.CurrentVerticalResolution
    }
}

$winsat = 'C:\Windows\Performance\WinSAT\DataStore'
$result.winsat = @{ exists = [bool](Test-Path $winsat) }
if ($result.winsat.exists) {
    $f = @(Get-ChildItem $winsat -Filter '*Formal*.xml' | Sort-Object LastWriteTime -Descending)
    if ($f.Count -gt 0) { $result.winsat.lastRun = $f[0].LastWriteTime.ToString('o') }
}

$json = $result | ConvertTo-Json -Depth 5 -Compress
Write-Output $json
