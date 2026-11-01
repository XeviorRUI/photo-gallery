#requires -Version 3.0
<#
  ============================================================
  scan.ps1 — 照片索引生成器
  ------------------------------------------------------------
  用法：
    1. 把照片放进 photos/ 文件夹（可建子文件夹当作分类，
       例：photos/风光/、photos/人像/，也可以直接放根目录）
    2. 双击运行本脚本（或在终端里执行 ./scan.ps1）
    3. 完成后会生成 gallery.js，刷新页面即可看到照片墙

  脚本会自动：
    - 递归扫描 photos/ 下所有常见格式图片
    - 读取每张照片的 EXIF（相机/镜头/光圈/快门/ISO/焦距/拍摄时间）
    - 按“分类轮流取”的顺序混排照片，并写入 gallery.js
  分类显示为照片上的小标签；墙上是混排浏览。
  ============================================================
#>
param(
  [string]$Root = '',
  [string]$OutputPath = '',
  [switch]$StrictImages,
  [ValidatePattern('^#[0-9A-Fa-f]{6}$')][string]$MatteColor = '#FFFFFF'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'average-color.ps1')

if ([string]::IsNullOrEmpty($Root)) { $Root = $PSScriptRoot }
if ([string]::IsNullOrEmpty($Root)) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }

$photosDir = Join-Path $Root 'photos'
if (-not (Test-Path -LiteralPath $photosDir)) {
  New-Item -ItemType Directory -Path $photosDir | Out-Null
  Write-Host "已创建 photos/ 文件夹，请把照片放进去后重新运行。" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '=== 照片墙索引生成器 ===' -ForegroundColor Cyan

# ---------- 1. 收集图片文件 ----------
$exts = @('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif')
$files = @(Get-ChildItem -Path $photosDir -File -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $exts -contains $_.Extension.ToLowerInvariant() } |
  Sort-Object FullName)

if (-not $files -or $files.Count -eq 0) {
  Write-Host 'photos/ 里还没有图片，本次仅生成空的索引。' -ForegroundColor Yellow
  $itemList = @()
} else {
  Write-Host ("扫描到 {0} 张图片，正在读取 EXIF ..." -f $files.Count)
}

# ---------- 2. 尝试加载 System.Drawing（用于读 EXIF 和图片尺寸） ----------
$useDrawing = $false
try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop | Out-Null
  $useDrawing = ([System.Drawing.Image] -as [type]) -ne $null
} catch {
  $useDrawing = $false
}

# ---------- 3. 工具函数 ----------

function Read-Prop([System.Drawing.Image]$img, [int]$id) {
  try { return $img.GetPropertyItem($id) } catch { return $null }
}

function Read-Ascii([object]$prop) {
  if ($null -eq $prop -or $prop.Value.Length -eq 0) { return $null }
  $s = [System.Text.Encoding]::ASCII.GetString($prop.Value)
  $s = $s.TrimEnd([char]0).Trim()
  if ($s -eq '') { return $null }
  return $s
}

function Read-Short([object]$prop) {
  if ($null -eq $prop -or $prop.Value.Length -lt 2) { return $null }
  return [BitConverter]::ToUInt16($prop.Value, 0)
}

function Read-UInt32BE([byte[]]$bytes, [int]$off) {
  return [uint32](([long]$bytes[$off] -shl 24) -bor ([long]$bytes[$off + 1] -shl 16) `
      -bor ([long]$bytes[$off + 2] -shl 8) -bor ([long]$bytes[$off + 3]))
}

function Test-Plausible([long]$num, [long]$den) {
  if ($den -le 0) { return $false }
  if ($num -le 0 -or $num -gt 1000000000) { return $false }
  $r = [double]$num / [double]$den
  return ($r -gt 1e-6 -and $r -lt 1e5)
}

function Read-Rational([object]$prop) {
  if ($null -eq $prop -or $prop.Value.Length -lt 4) { return $null }
  $b = $prop.Value
  $num = 0L; $den = 0L

  if ($prop.Type -eq 3 -and $b.Length -ge 4) {
    # 部分软件把小数编码成两个 UInt16（例：35/10）
    $num = [long][BitConverter]::ToUInt16($b, 0)
    $den = [long][BitConverter]::ToUInt16($b, 2)
    if (Test-Plausible $num $den) { return [double]$num / [double]$den }
    return $null
  }

  if ($prop.Type -eq 10 -and $b.Length -ge 8) {
    # SRATIONAL：有符号
    $num = [long][BitConverter]::ToInt32($b, 0)
    $den = [long][BitConverter]::ToInt32($b, 4)
    if (Test-Plausible $num $den) { return [double]$num / [double]$den }
    return $null
  }

  # 标准 RATIONAL（8 字节，两个 UInt32）
  $num = [long][BitConverter]::ToUInt32($b, 0)
  $den = [long][BitConverter]::ToUInt32($b, 4)
  if (Test-Plausible $num $den) {
    return [double]$num / [double]$den
  }
  # 大端相机回退
  $num = [long](Read-UInt32BE $b 0)
  $den = [long](Read-UInt32BE $b 4)
  if (Test-Plausible $num $den) {
    return [double]$num / [double]$den
  }
  return $null
}

function Format-Number([double]$value) {
  if ([double]::IsNaN($value) -or [double]::IsInfinity($value)) { return $null }
  $r = [math]::Round($value, 2)
  $inv = [Globalization.CultureInfo]::InvariantCulture
  if ($r -eq [math]::Floor($r)) { return $r.ToString('0', $inv) }
  return $r.ToString('0.##', $inv)
}

function Format-Exposure([double]$sec) {
  if ($sec -le 0) { return $null }
  $inv = [Globalization.CultureInfo]::InvariantCulture
  if ($sec -lt 1) {
    $invSec = [math]::Round(1.0 / $sec)
    if ([math]::Abs((1.0 / $sec) - $invSec) -lt 0.05) {
      return ('1/{0} s' -f $invSec)
    }
    return ($sec.ToString('0.##', $inv) + ' s')
  }
  return ($sec.ToString('0.##', $inv) + ' s')
}

function Format-DateTime([string]$raw) {
  if ([string]::IsNullOrEmpty($raw)) { return $null }
  $t = $raw -replace '^(\d{4}):(\d{2}):(\d{2})', '$1-$2-$3'
  return $t.Trim()
}

function Get-JpegDims([string]$path) {
  # 不依赖 System.Drawing 时，手动解析 JPEG SOF 得到宽高
  try {
    $fs = [System.IO.File]::OpenRead($path)
    try {
      $buf = New-Object byte[] 65536
      $head = New-Object byte[] 2
      if ($fs.Read($head, 0, 2) -lt 2) { return $null }
      if ($head[0] -ne 0xFF -or $head[1] -ne 0xD8) { return $null }

      while ($true) {
        $m = New-Object byte[] 2
        if ($fs.Read($m, 0, 2) -lt 2) { break }
        if ($m[0] -ne 0xFF) { break }
        $code = $m[1]
        if ($code -eq 0xD9 -or $code -eq 0xDA) { break }
        if ($code -eq 0x01) { continue }
        $lenB = New-Object byte[] 2
        if ($fs.Read($lenB, 0, 2) -lt 2) { break }
        $segLen = [int]($lenB[0] -shl 8) -bor $lenB[1]
        if ($segLen -lt 2) { break }
        $isSOF = ($code -ge 0xC0 -and $code -le 0xCF) -and
                 $code -ne 0xC4 -and $code -ne 0xC8 -and $code -ne 0xCC
        if ($isSOF) {
          $body = New-Object byte[] 5
          if ($fs.Read($body, 0, 5) -lt 5) { break }
          $h = ([int]$body[1] -shl 8) -bor $body[2]
          $w = ([int]$body[3] -shl 8) -bor $body[4]
          if ($w -gt 0 -and $h -gt 0) {
            return @{ Width = $w; Height = $h }
          }
          break
        }
        $skip = $segLen - 2
        while ($skip -gt 0) {
          $n = [Math]::Min($skip, $buf.Length)
          $got = $fs.Read($buf, 0, $n)
          if ($got -le 0) { break }
          $skip -= $got
        }
      }
    } finally {
      $fs.Dispose()
    }
  } catch { }
  return $null
}

# ---------- 4. 单张照片信息 ----------
function New-PhotoEntry([System.IO.FileInfo]$f) {
  $averageColor = $null
  $rel = $f.FullName.Substring($photosDir.Length).TrimStart('\', '/').Replace('\', '/')
  $relFile = 'photos/' + $rel

  $cat = if ($f.Directory.FullName -eq $photosDir) { '未分类' } else { $f.Directory.Name }

  $make = $null; $model = $null; $lens = $null
  $fnumber = $null; $exposure = $null; $iso = $null; $focal = $null; $taken = $null
  $w = $null; $h = $null
  $ok = $false

  if ($useDrawing) {
    try {
      $img = [System.Drawing.Image]::FromFile($f.FullName, $true)
      try {
        $w = $img.Width
        $h = $img.Height

        $orient = Read-Short (Read-Prop $img 0x0112)
        if ($orient -ge 5 -and $orient -le 8) {
          $tmp = $w; $w = $h; $h = $tmp
        }

        $make = Read-Ascii (Read-Prop $img 0x010F)
        $model = Read-Ascii (Read-Prop $img 0x0110)
        $lens = Read-Ascii (Read-Prop $img 0xA434)
        if (-not $lens) { $lens = Read-Ascii (Read-Prop $img 0x0095) }

        $dt = Read-Ascii (Read-Prop $img 0x9003)
        if (-not $dt) { $dt = Read-Ascii (Read-Prop $img 0x0132) }
        $taken = Format-DateTime $dt

        $fn = Read-Rational (Read-Prop $img 0x829D)
        if ($null -ne $fn) { $fnumber = Format-Number $fn }

        $ex = Read-Rational (Read-Prop $img 0x829A)
        if ($null -ne $ex) { $exposure = Format-Exposure $ex }

        $isoProp = Read-Prop $img 0x8827
        if ($null -ne $isoProp) {
          if ($isoProp.Type -eq 3) {
            $iso = Read-Short $isoProp
          } else {
            $iv = Read-Rational $isoProp
            if ($null -ne $iv) { $iso = [int][math]::Round($iv) }
          }
        }

        $fl = Read-Rational (Read-Prop $img 0x920A)
        if ($null -ne $fl) {
          $foc = Format-Number $fl
          if ($foc) { $focal = $foc + ' mm' }
        }

        $averageColor = [GalleryPixelAverage]::Compute($img, [Drawing.ColorTranslator]::FromHtml($MatteColor))
        $ok = ($w -gt 0 -and $h -gt 0)
      } finally {
        $img.Dispose()
      }
    } catch {
      $ok = $false
    }
  }

  if (-not $ok) {
    # 回退：仅解析 JPEG 尺寸（无法读 EXIF）
    if ($f.Extension.ToLowerInvariant() -in @('.jpg', '.jpeg')) {
      $d = Get-JpegDims $f.FullName
      if ($d) { $w = $d.Width; $h = $d.Height; $ok = $true }
    }
  }

  if (-not $ok) {
    Write-Host ("  跳过无法识别的文件: {0}" -f $rel) -ForegroundColor DarkYellow
    return $null
  }

  return @{
    id       = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.Substring(0,24).ToLowerInvariant()
    file     = $relFile
    title    = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    category = $cat
    width    = $w
    height   = $h
    averageColor = $averageColor
    averageColorMatte = $MatteColor.ToUpperInvariant()
    exif     = @{
      make     = $make
      model    = $model
      lens     = $lens
      fnumber  = $fnumber
      exposure = $exposure
      iso      = $iso
      focal    = $focal
      taken    = $taken
    }
  }
}

# Optional author-managed metadata, keyed by the path below photos/.
$overrides = @{}
$catalogPath = Join-Path $Root 'catalog.json'
if (Test-Path -LiteralPath $catalogPath) {
  $catalog = Get-Content -LiteralPath $catalogPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($property in $catalog.PSObject.Properties) { $overrides[$property.Name] = $property.Value }
}
$seenIds = @{}
# ---------- 5. 按分类“轮流取”混排 ----------
$entries = New-Object System.Collections.ArrayList
$failed = 0
$metadataCache = Join-Path $Root '.gallery-cache/exif-average-v2'
if (Test-Path -LiteralPath $metadataCache) {
  $cursor = Get-Item -LiteralPath $metadataCache -Force
  while ($null -ne $cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Metadata cache cannot use linked directories.' }
    $cursor = $cursor.Parent
  }
}
New-Item -ItemType Directory -Path $metadataCache -Force | Out-Null
foreach ($f in $files) {
  $hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $cachedMetadata = Join-Path $metadataCache ($hash + '-' + $MatteColor.Substring(1).ToUpperInvariant() + '.json')
  $e = $null
  if (Test-Path -LiteralPath $cachedMetadata) {
    if ((Get-Item -LiteralPath $cachedMetadata -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked metadata cache file.' }
    try {
      $cached = Get-Content -LiteralPath $cachedMetadata -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($cached.width -gt 0 -and $cached.height -gt 0) {
        $e = @{}
        foreach ($property in $cached.PSObject.Properties) { $e[$property.Name] = $property.Value }
        $e.file = 'photos/' + $f.FullName.Substring($photosDir.Length).TrimStart('\', '/').Replace('\', '/')
        $e.title = [IO.Path]::GetFileNameWithoutExtension($f.Name)
        $e.category = if ($f.Directory.FullName -eq $photosDir) { '未分类' } else { $f.Directory.Name }
      }
    } catch { $e = $null }
  }
  if ($null -eq $e) {
    $e = New-PhotoEntry $f
    if ($null -ne $e) {
      $e | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $cachedMetadata -Encoding UTF8
    }
  }
  if ($null -ne $e) {
    $relative = $e.file.Substring(7)
    if ($overrides.ContainsKey($relative)) {
      foreach ($field in @('id','title','description','category','tags','order')) {
        $property = $overrides[$relative].PSObject.Properties[$field]
        if ($null -ne $property) { $e[$field] = $property.Value }
      }
    }
    if ([string]$e.id -notmatch '^[a-zA-Z0-9_-]+$') { throw "Invalid photo id: $relative" }
    if ($seenIds.ContainsKey([string]$e.id)) { throw "Duplicate photo id for $relative; assign distinct ids in catalog.json." }
    $seenIds[[string]$e.id] = $true
    [void]$entries.Add($e)
  } else {
    $failed++
  }
}

$groups = @{}
foreach ($e in $entries) {
  if (-not $groups.ContainsKey($e.category)) {
    $groups[$e.category] = New-Object System.Collections.ArrayList
  }
  [void]$groups[$e.category].Add($e)
}

$cats = @($groups.Keys | Sort-Object)
$mixed = New-Object System.Collections.ArrayList
$maxLen = 0
foreach ($c in $cats) { if ($groups[$c].Count -gt $maxLen) { $maxLen = $groups[$c].Count } }
for ($k = 0; $k -lt $maxLen; $k++) {
  foreach ($c in $cats) {
    if ($k -lt $groups[$c].Count) { [void]$mixed.Add($groups[$c][$k]) }
  }
}

if ($StrictImages -and $failed -gt 0) {
  throw "$failed image(s) could not be decoded. Supported by the Windows pipeline: JPEG, PNG, BMP, GIF (first frame), TIFF (first page). Convert WebP/AVIF or damaged files before building. Previous deployment retained."
}
# ---------- 6. 输出 gallery.js ----------
$payload = @{
  generated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  total     = $mixed.Count
  items     = $mixed
}
$json = ConvertTo-Json -InputObject $payload -Depth 6

$out = if ($OutputPath) { $OutputPath } else { Join-Path $Root 'gallery.js' }
$content = "/* 本文件由 scan.ps1 自动生成，请勿手动编辑 */`r`nwindow.GALLERY_DATA = " + $json + ";`r`n"
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($out, $content, $utf8)

Write-Host ''
Write-Host ('完成！共索引照片 {0} 张，写入 {1}' -f $mixed.Count, 'gallery.js') -ForegroundColor Green
if ($failed -gt 0) {
  Write-Host ('（{0} 个文件无法识别已跳过）' -f $failed) -ForegroundColor DarkYellow
}
Write-Host '现在刷新网页即可看到照片墙。' -ForegroundColor Cyan
Write-Host ''
