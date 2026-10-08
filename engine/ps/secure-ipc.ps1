function Initialize-SecureIpc {
    $root = 'C:\ProgramData\RedVolt Lab\ipc'
    $full = [IO.Path]::GetFullPath($root)
    $drive = [IO.Path]::GetPathRoot($full)
    $current = $drive

    foreach ($part in $full.Substring($drive.Length).Split('\')) {
        if (-not $part) { continue }
        $current = Join-Path $current $part
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Secure IPC path contains a reparse point'
            }
        }
    }

    New-Item -ItemType Directory -Path $full -Force -ErrorAction Stop | Out-Null
    & icacls.exe $full /reset | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to reset secure IPC permissions' }
    & icacls.exe $full /inheritance:r /grant:r `
        '*S-1-5-18:(OI)(CI)F' `
        '*S-1-5-32-544:(OI)(CI)F' `
        '*S-1-5-32-545:(OI)(CI)(RX,DC)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Unable to secure IPC permissions' }
    return $full
}
