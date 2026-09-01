param(
  [string]$PngPath = 'build/icon.png',
  [string]$Output = 'dist/.icon-ico/icon-256.ico',
  [int]$Size = 256
)

# 生成单尺寸 PNG-encoded ICO (只含一个尺寸).
# 用途: 喂给 rcedit v0.2.0 嵌入 PE 图标.
# rcedit v0.2.0 处理 multi-size PNG-encoded ICO 有 bug (主图标仍保留旧的),
# 改用单尺寸 ICO 后, ExtractAssociatedIcon 能拿到新图标.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$srcPath = (Resolve-Path $PngPath).Path
if (-not (Test-Path $srcPath)) { Write-Error "Cannot find $srcPath"; exit 1 }

$img = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, 0, 0, $Size, $Size)
$g.Dispose()

$pngMs = New-Object System.IO.MemoryStream
$bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngMs.ToArray()
$pngMs.Dispose()
$img.Dispose()
$bmp.Dispose()

# ICO header: 6 bytes
# ICONDIRENTRY: 16 bytes (width=0 means $Size=256)
$dir = Split-Path -Parent $Output
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$fs = [System.IO.File]::Create($Output)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0)              # reserved
$bw.Write([UInt16]1)              # type = ICO
$bw.Write([UInt16]1)              # count = 1

# ICONDIRENTRY
$w = if ($Size -ge 256) { 0 } else { [byte]$Size }
$h = if ($Size -ge 256) { 0 } else { [byte]$Size }
$bw.Write([byte]$w)
$bw.Write([byte]$h)
$bw.Write([byte]0)               # color palette
$bw.Write([byte]0)               # reserved
$bw.Write([UInt16]1)             # planes
$bw.Write([UInt16]32)            # bitcount
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)            # offset: 6 + 16

$bw.Write($pngBytes)
$bw.Flush()
$fs.Close()

Write-Host ("Single-size ICO ({0}x{0}): {1} ({2} bytes)" -f $Size, $Output, (Get-Item $Output).Length)