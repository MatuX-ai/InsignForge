param(
  [string]$PngPath = 'build/icon.png',
  [string]$Output = 'dist/.icon-ico/icon.ico'
)

Add-Type -AssemblyName System.Drawing

# 检查输入
$srcPath = (Resolve-Path $PngPath).Path
if (-not (Test-Path $srcPath)) { Write-Error "❌ 找不到 $srcPath"; exit 1 }
$img = [System.Drawing.Image]::FromFile($srcPath)
Write-Host ("输入: {0}x{1}, {2} 像素格式" -f $img.Width, $img.Height, $img.PixelFormat)

# ICO 尺寸: 16, 24, 32, 48, 64, 128, 256 (Windows 常用)
$sizes = @(16, 24, 32, 48, 64, 128, 256)

# 把每个尺寸渲染为 32 位 BGRA PNG (PNG-in-ICO 格式 Windows Vista+ 支持)
$entries = @()
foreach ($sz in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $sz, $sz, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($img, 0, 0, $sz, $sz)
  $g.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $pngBytes = $ms.ToArray()
  $ms.Dispose()
  $entries += [pscustomobject]@{ Size = $sz; Bytes = $pngBytes; Length = $pngBytes.Length }
  Write-Host ("  渲染 {0}x{0} → {1} bytes (PNG)" -f $sz, $pngBytes.Length)
}
$img.Dispose()

# 写 ICO 文件
$dir = Split-Path -Parent $Output
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$fs = [System.IO.File]::Create($Output)

$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0)                          # reserved
$bw.Write([UInt16]1)                          # type=ICO
$bw.Write([UInt16]$entries.Count)             # count

$dataStart = 6 + $entries.Count * 16
$running = 0
foreach ($e in $entries) {
  $w = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
  $h = if ($e.Size -ge 256) { [byte]0 } else { [byte]$e.Size }
  $bw.Write([byte]$w)            # width
  $bw.Write([byte]$h)            # height
  $bw.Write([byte]0)             # color palette
  $bw.Write([byte]0)             # reserved
  $bw.Write([UInt16]1)           # color planes
  $bw.Write([UInt16]32)          # bits per pixel
  $bw.Write([UInt32]$e.Length)   # data size
  $bw.Write([UInt32]($dataStart + $running))  # data offset
  $running += $e.Length
}

foreach ($e in $entries) { $bw.Write($e.Bytes) }
$bw.Flush()
$fs.Close()

Write-Host ("`n✅ 生成 ICO: {0} ({1} bytes)" -f $Output, (Get-Item $Output).Length)
Write-Host ("   包含 {0} 个尺寸: {1}" -f $entries.Count, ($entries.Size -join ', '))
