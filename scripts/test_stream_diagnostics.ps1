<#
.SYNOPSIS
    Standalone diagnostic script to test scrcpy-server v3.1 connection and H.264 stream.

.DESCRIPTION
    Pushes scrcpy-server-v3.1.jar, establishes an ADB tunnel forward, launches the server
    via app_process, and reads the initial H.264 video header packets.

.PARAMETER AdbPath
    Path to adb.exe (defaults to PATH or standard Android SDK location).

.PARAMETER Serial
    Target device serial number (defaults to first connected device).
#>
param(
    [string]$AdbPath = "adb",
    [string]$Serial = "",
    [int]$Port = 27186,
    [string]$Scid = "1a2b3c4d"
)

# Resolve ADB if default
if ($AdbPath -eq "adb" -and -not (Get-Command adb -ErrorAction SilentlyContinue)) {
    $fallbackAdb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
    if (Test-Path $fallbackAdb) {
        $AdbPath = $fallbackAdb
    }
}

# Resolve device serial if omitted
if (-not $Serial) {
    $devices = & $AdbPath devices | Where-Object { $_ -match "\tdevice$" }
    if ($devices.Count -gt 0) {
        $Serial = ($devices[0] -split "\t")[0]
        Write-Host "Auto-detected device: $Serial" -ForegroundColor Cyan
    } else {
        Write-Error "No authorized Android device found via ADB."
        exit 1
    }
}

$jarPath = Join-Path $PSScriptRoot "..\assets\scrcpy-server-v3.1.jar"
if (-not (Test-Path $jarPath)) {
    $jarPath = Join-Path $PSScriptRoot "..\assets\scrcpy-server.jar"
}

Write-Host "=== FloatingPhone Scrcpy Stream Diagnostic ===" -ForegroundColor Green
Write-Host "ADB:    $AdbPath"
Write-Host "Serial: $Serial"
Write-Host "Jar:    $jarPath"
Write-Host "Port:   $Port"

Write-Host "`n[1/5] Pushing scrcpy server jar..." -ForegroundColor Yellow
& $AdbPath -s $Serial push $jarPath /data/local/tmp/scrcpy-server.jar | Out-Null

Write-Host "[2/5] Setting up ADB port forward..." -ForegroundColor Yellow
& $AdbPath -s $Serial forward "tcp:$Port" "localabstract:scrcpy_$Scid"

Write-Host "[3/5] Starting scrcpy server on device..." -ForegroundColor Yellow
$job = Start-Job {
    param($adb, $serial, $scid)
    & $adb -s $serial shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 3.1 scid=$scid tunnel_forward=true audio=false control=false max_size=720" 2>&1
} -ArgumentList $AdbPath, $Serial, $Scid

Start-Sleep -Milliseconds 1200

Write-Host "[4/5] Connecting to stream socket on port $Port..." -ForegroundColor Yellow
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $tcp.Connect("127.0.0.1", $Port)
    $s = $tcp.GetStream()
    $s.ReadTimeout = 4000

    # 1. Dummy byte
    $dummy = New-Object byte[] 1
    $r = $s.Read($dummy, 0, 1)
    Write-Host "  -> Dummy byte: 0x$($dummy[0].ToString('X2'))" -ForegroundColor Green

    # 2. Codec ID (4 bytes ASCII)
    $hdr = New-Object byte[] 4
    $r = $s.Read($hdr, 0, 4)
    $codec = [System.Text.Encoding]::ASCII.GetString($hdr)
    Write-Host "  -> Codec: '$codec'" -ForegroundColor Green

    # 3. Video dimensions metadata (12 bytes: 4 bytes empty + 4 bytes width + 4 bytes height)
    $meta = New-Object byte[] 12
    $r = $s.Read($meta, 0, 12)
    $w = ([int]$meta[4] -shl 24) -bor ([int]$meta[5] -shl 16) -bor ([int]$meta[6] -shl 8) -bor [int]$meta[7]
    $h = ([int]$meta[8] -shl 24) -bor ([int]$meta[9] -shl 16) -bor ([int]$meta[10] -shl 8) -bor [int]$meta[11]
    Write-Host "  -> Resolution: ${w}x${h}" -ForegroundColor Green

    # 4. First frame header (12 bytes: 8 bytes PTS + 4 bytes size)
    $fhdr = New-Object byte[] 12
    $r = $s.Read($fhdr, 0, 12)
    $sz = ([int]$fhdr[8] -shl 24) -bor ([int]$fhdr[9] -shl 16) -bor ([int]$fhdr[10] -shl 8) -bor [int]$fhdr[11]
    Write-Host "  -> Initial frame/config size: $sz bytes" -ForegroundColor Green

    Write-Host "`n[5/5] Stream verified successfully!" -ForegroundColor Green
    $tcp.Close()
} catch {
    Write-Error "Failed to read stream: $_"
} finally {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -ErrorAction SilentlyContinue
    & $AdbPath -s $Serial forward --remove "tcp:$Port" 2>$null
}

