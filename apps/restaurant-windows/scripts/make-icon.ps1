<#
.SYNOPSIS
  Builds the app icon (app.ico, 16..256 px) and logo.png (512 px) from the real DS Delivery logo
  ("Minimalist Green DS Delivery Logo.png" in the repository root).

.DESCRIPTION
  The logo is cropped to its visible part and centred on a rounded light tile (the logo is green on white, so it
  needs a light background on the dark window). Needs Windows PowerShell 5.1 (System.Drawing). Run once, commit the result.
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$source = Join-Path $root "Minimalist Green DS Delivery Logo.png"
$out = Join-Path (Split-Path -Parent $PSScriptRoot) "src\DsRestaurant.App\Resources"
New-Item -ItemType Directory -Force $out | Out-Null

$src = New-Object System.Drawing.Bitmap $source
$bg = $src.GetPixel(4, 4)

# Visible bounds: every pixel that differs clearly from the background.
$minX = $src.Width; $minY = $src.Height; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $src.Height; $y += 2) {
    for ($x = 0; $x -lt $src.Width; $x += 2) {
        $p = $src.GetPixel($x, $y)
        if ([Math]::Abs($p.R - $bg.R) + [Math]::Abs($p.G - $bg.G) + [Math]::Abs($p.B - $bg.B) -gt 60) {
            if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$crop = New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
Write-Host "Logo bounds: $crop"

function Draw-Logo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $r = [single]($size * 0.22)
    $d = $r * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $bg.R, $bg.G, $bg.B))
    $g.FillPath($brush, $path)

    $w = $size * 0.78
    $h = $w * $crop.Height / $crop.Width
    $dest = New-Object System.Drawing.RectangleF ([single](($size - $w) / 2)), ([single](($size - $h) / 2)), ([single]$w), ([single]$h)
    $g.DrawImage($src, $dest, [System.Drawing.RectangleF]$crop, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $bmp
}

function Png-Bytes($bmp) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($s in $sizes) {
    $b = Draw-Logo $s
    [pscustomobject]@{ Size = $s; Bytes = (Png-Bytes $b) }
    $b.Dispose()
}
$big = Draw-Logo 512
$big.Save((Join-Path $out "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$big.Dispose()

$ms = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$images.Count)
$offset = 6 + 16 * $images.Count
foreach ($i in $images) {
    $dim = if ($i.Size -ge 256) { 0 } else { $i.Size }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$i.Bytes.Length); $w.Write([uint32]$offset)
    $offset += $i.Bytes.Length
}
foreach ($i in $images) { $w.Write($i.Bytes) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $out "app.ico"), $ms.ToArray())
$src.Dispose()
Write-Host "app.ico va logo.png yozildi: $out"
