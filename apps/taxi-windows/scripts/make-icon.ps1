<#
.SYNOPSIS
  Draws the DS logo (the phone app's launcher icon: yellow tile, black taxi) and writes
  src\DsTaxi.App\Resources\app.ico (16..256 px) and logo.png (256 px).

.DESCRIPTION
  The shapes are copied from apps\taxi-android\app\src\main\res\drawable\ic_launcher_foreground.xml (108 x 108 viewport);
  only the middle 64 x 64 part is used so the car fills the tile. Needs Windows PowerShell 5.1 (System.Drawing). Run once, commit the result.
  The tray icon (Services\TrayService.cs) draws the same shapes in code - keep both in step.
#>
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$out = Join-Path (Split-Path -Parent $PSScriptRoot) "src\DsTaxi.App\Resources"
New-Item -ItemType Directory -Force $out | Out-Null

$yellow = [System.Drawing.Color]::FromArgb(0xFF, 0xC4, 0x00)
$ink = [System.Drawing.Color]::FromArgb(0x1B, 0x1B, 0x1F)

function P($x, $y) { New-Object System.Drawing.PointF ([single]$x), ([single]$y) }

# Quadratic curve p0 -> p1 with control c, as the cubic GDI+ wants.
function AddQuad($path, $x0, $y0, $cx, $cy, $x1, $y1) {
    $c1 = P ($x0 + 2.0 / 3 * ($cx - $x0)) ($y0 + 2.0 / 3 * ($cy - $y0))
    $c2 = P ($x1 + 2.0 / 3 * ($cx - $x1)) ($y1 + 2.0 / 3 * ($cy - $y1))
    $path.AddBezier((P $x0 $y0), $c1, $c2, (P $x1 $y1))
}

function Draw-Logo([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # yellow rounded tile
    $r = $size * 0.22
    $d = $r * 2
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $tile.AddArc(0, 0, $d, $d, 180, 90)
    $tile.AddArc($size - $d, 0, $d, $d, 270, 90)
    $tile.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $tile.AddArc(0, $size - $d, $d, $d, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $yellow), $tile)

    # car, in the 108-unit viewport of the phone icon, cropped to 22..86
    $g.ScaleTransform($size / 64.0, $size / 64.0)
    $g.TranslateTransform(-22, -22)
    $inkBrush = New-Object System.Drawing.SolidBrush $ink
    $yellowBrush = New-Object System.Drawing.SolidBrush $yellow

    $body = New-Object System.Drawing.Drawing2D.GraphicsPath
    $body.StartFigure()
    $body.AddLine((P 30 60), (P 35 46))
    AddQuad $body 35 46 36 43 40 43
    $body.AddLine((P 40 43), (P 68 43))
    AddQuad $body 68 43 72 43 73 46
    $body.AddLine((P 73 46), (P 78 60))
    $body.AddLine((P 78 60), (P 78 70))
    $body.AddLine((P 78 70), (P 73 70))
    $body.AddLine((P 73 70), (P 73 66))
    $body.AddLine((P 73 66), (P 35 66))
    $body.AddLine((P 35 66), (P 35 70))
    $body.AddLine((P 35 70), (P 30 70))
    $body.CloseFigure()
    $g.FillPath($inkBrush, $body)

    $g.FillPolygon($yellowBrush, [System.Drawing.PointF[]]@((P 39 48), (P 69 48), (P 73 58), (P 35 58)))
    $g.FillEllipse($yellowBrush, 34.5, 59.5, 5, 5)
    $g.FillEllipse($yellowBrush, 68.5, 59.5, 5, 5)
    $g.FillRectangle($inkBrush, 49, 38, 10, 5)

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
    if ($s -eq 256) { $b.Save((Join-Path $out "logo.png"), [System.Drawing.Imaging.ImageFormat]::Png) }
    $b.Dispose()
}

# ICO container with PNG frames (Windows Vista and later)
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
Write-Host "app.ico va logo.png yozildi: $out"
