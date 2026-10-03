$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cpuLoad = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average

$disks = New-Object System.Collections.ArrayList
foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3')) {
    [void]$disks.Add([pscustomobject]@{
        device = [string]$d.DeviceID
        label  = [string]$d.VolumeName
        total  = [int64]$d.Size
        free   = [int64]$d.FreeSpace
    })
}

[pscustomobject]@{
    osCaption  = [string]$os.Caption
    osVersion  = [string]$os.Version
    osArch     = [string]$os.OSArchitecture
    installDate = if ($os.InstallDate) { $os.InstallDate.ToString('o') } else { $null }
    lastBoot   = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('o') } else { $null }
    cpuName    = if ($cpu) { [string]$cpu.Name.Trim() } else { '' }
    cpuCores   = if ($cpu) { [int]$cpu.NumberOfLogicalProcessors } else { 0 }
    cpuLoad    = if ($cpuLoad) { [double]$cpuLoad } else { 0 }
    totalRam   = [int64]$os.TotalVisibleMemorySize * 1024
    freeRam    = [int64]$os.FreePhysicalMemory * 1024
    disks      = $disks
} | ConvertTo-Json -Depth 4 -Compress
