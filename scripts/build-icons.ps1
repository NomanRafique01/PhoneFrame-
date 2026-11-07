Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"

$sourcePath = Join-Path $PSScriptRoot "..\Four Phone Icon.png"
$assetsDir = Join-Path $PSScriptRoot "..\assets"

if (-not (Test-Path $sourcePath)) {
    Write-Error "Source file not found at $sourcePath"
    exit 1
}

Write-Host "Loading source image from: $sourcePath"
$sourceStream = [System.IO.File]::OpenRead($sourcePath)
$srcBitmap = [System.Drawing.Bitmap]::FromStream($sourceStream)
Write-Host "Source dimensions: $($srcBitmap.Width)x$($srcBitmap.Height)"

function Resize-Bitmap($src, [int]$w, [int]$h) {
    $dest = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    return $dest
}

function Get-PngBytes($bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# Creates a genuine 32-bit BGRA DIB entry (BITMAPINFOHEADER + BGRA pixels + 1-bit AND mask)
# Required by Windows Shell, GDI, WM_SETICON, and Taskbar.
function Get-DibBytes($bmp) {
    $w = $bmp.Width
    $h = $bmp.Height
    
    $maskRowBytes = [int]([Math]::Ceiling($w / 32.0) * 4)
    $maskSize = $maskRowBytes * $h
    $colorSize = $w * $h * 4

    $ms = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($ms)

    # BITMAPINFOHEADER (40 bytes)
    $writer.Write([uint32]40)                      # biSize
    $writer.Write([int32]$w)                       # biWidth
    $writer.Write([int32]($h * 2))                 # biHeight (double for XOR + AND masks)
    $writer.Write([uint16]1)                       # biPlanes
    $writer.Write([uint16]32)                      # biBitCount (32-bit ARGB)
    $writer.Write([uint32]0)                       # biCompression (BI_RGB)
    $writer.Write([uint32]($colorSize + $maskSize))# biSizeImage
    $writer.Write([int32]0)                        # biXPelsPerMeter
    $writer.Write([int32]0)                        # biYPelsPerMeter
    $writer.Write([uint32]0)                       # biClrUsed
    $writer.Write([uint32]0)                       # biClrImportant

    # Read BGRA scanlines from bottom to top
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $bmpData = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = [Math]::Abs($bmpData.Stride)
    $rawBytes = New-Object byte[] ($stride * $h)
    [System.Runtime.InteropServices.Marshal]::Copy($bmpData.Scan0, $rawBytes, 0, $rawBytes.Length)
    $bmp.UnlockBits($bmpData)

    for ($y = $h - 1; $y -ge 0; $y--) {
        $rowOffset = $y * $stride
        $writer.Write($rawBytes, $rowOffset, $w * 4)
    }

    # 1-bit AND mask (all zeros because 32-bit alpha channel defines transparency)
    $maskBytes = New-Object byte[] $maskSize
    $writer.Write($maskBytes)

    $writer.Flush()
    $result = $ms.ToArray()
    $writer.Close()
    $ms.Dispose()
    return $result
}

# 1. Generate master phoneframe-icon.png (1024x1024)
Write-Host "Generating 1024x1024 master assets/phoneframe-icon.png..."
$masterPngBmp = Resize-Bitmap $srcBitmap 1024 1024
$masterPngPath = Join-Path $assetsDir "phoneframe-icon.png"
$masterPngBmp.Save($masterPngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$masterPngBmp.Dispose()
Write-Host "Saved: $masterPngPath (Size: $((Get-Item $masterPngPath).Length) bytes)"

# 2. Generate multi-resolution phoneframe-icon.ico
# Standard Win32 GDI sizes (16, 24, 32, 48, 64, 128) use true 32bpp DIB for 100% native compatibility.
# 256x256 uses modern PNG compression for crisp high-DPI scaling.
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$icoEntries = @()

foreach ($sz in $sizes) {
    Write-Host "Resampling $sz x $sz..."
    $resized = Resize-Bitmap $srcBitmap $sz $sz
    if ($sz -eq 256) {
        $bytes = Get-PngBytes $resized
    } else {
        $bytes = Get-DibBytes $resized
    }
    $resized.Dispose()
    $icoEntries += ,@($sz, $bytes)
}

$icoPath = Join-Path $assetsDir "phoneframe-icon.ico"
Write-Host "Writing multi-resolution ICO to: $icoPath"

$icoStream = [System.IO.File]::Create($icoPath)
$writer = New-Object System.IO.BinaryWriter($icoStream)

# Header
$writer.Write([uint16]0) # Reserved
$writer.Write([uint16]1) # Type (1=ICO)
$writer.Write([uint16]$icoEntries.Count) # Image count

# Calculate initial offset for image data
$dataOffset = 6 + ($icoEntries.Count * 16)

# Write Directory Entries
foreach ($item in $icoEntries) {
    $sz = $item[0]
    $bytes = $item[1]
    
    $wByte = if ($sz -eq 256) { [byte]0 } else { [byte]$sz }
    $hByte = if ($sz -eq 256) { [byte]0 } else { [byte]$sz }
    
    $writer.Write($wByte)            # Width (0 = 256)
    $writer.Write($hByte)            # Height (0 = 256)
    $writer.Write([byte]0)           # Color count
    $writer.Write([byte]0)           # Reserved
    $writer.Write([uint16]1)         # Color planes
    $writer.Write([uint16]32)        # Bits per pixel
    $writer.Write([uint32]$bytes.Length) # Image bytes
    $writer.Write([uint32]$dataOffset)   # Offset
    
    $dataOffset += $bytes.Length
}

# Write Image Data
foreach ($item in $icoEntries) {
    [byte[]]$bytes = $item[1]
    $writer.Write($bytes, 0, $bytes.Length)
}

$writer.Flush()
$writer.Close()
$icoStream.Dispose()

# 3. Update embedded base64 in download button SVG if present
$svgPath = Join-Path $assetsDir "btn-download-v0.1.2.svg"
if (Test-Path $svgPath) {
    Write-Host "Updating embedded icon in $svgPath..."
    $btnBmp = Resize-Bitmap $srcBitmap 96 96
    $btnPngBytes = Get-PngBytes $btnBmp
    $btnBmp.Dispose()
    $base64 = [Convert]::ToBase64String($btnPngBytes)
    $svgContent = [System.IO.File]::ReadAllText($svgPath)
    $svgContent = [System.Text.RegularExpressions.Regex]::Replace($svgContent, 'href="data:image/png;base64,[^"]+"', "href=`"data:image/png;base64,$base64`"")
    [System.IO.File]::WriteAllText($svgPath, $svgContent)
    Write-Host "Successfully updated $svgPath"
}

$srcBitmap.Dispose()
$sourceStream.Dispose()

Write-Host "Saved: $icoPath (Size: $((Get-Item $icoPath).Length) bytes)"
Write-Host "Icon generation completed successfully."
