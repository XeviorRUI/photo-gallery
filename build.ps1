#requires -Version 5.1
[CmdletBinding()]
param(
  [string]$Root = '',
  [string]$Output = 'dist',
  [ValidateRange(320, 2400)][int]$ThumbnailMaxSide = 1080,
  [ValidateRange(960, 6000)][int]$DetailMaxSide = 2560,
  [ValidateRange(45, 95)][int]$ThumbnailQuality = 78,
  [ValidateRange(60, 100)][int]$DetailQuality = 88,
  [ValidatePattern('^#[0-9A-Fa-f]{6}$')][string]$MatteColor = '#FFFFFF',
  [switch]$SkipScan
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) { $Root = $PSScriptRoot }
$sourceRoot = [System.IO.Path]::GetFullPath($Root)
$sourcePrefix = $sourceRoot.TrimEnd([char[]]@(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
)) + [System.IO.Path]::DirectorySeparatorChar

$outputRoot = if ([System.IO.Path]::IsPathRooted($Output)) {
  [System.IO.Path]::GetFullPath($Output)
} else {
  [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $Output))
}

if ($outputRoot.Equals($sourceRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $outputRoot.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The deployment directory must be a child of the project directory.'
}

$scanScript = Join-Path $sourceRoot 'scan.ps1'
$galleryPath = Join-Path $sourceRoot 'gallery.js'
if (-not $SkipScan) {
  if (-not (Test-Path -LiteralPath $scanScript -PathType Leaf)) {
    throw "Missing index generator: $scanScript"
  }
  & $scanScript -Root $sourceRoot
}
if (-not (Test-Path -LiteralPath $galleryPath -PathType Leaf)) {
  throw "Missing generated gallery index: $galleryPath"
}

Add-Type -AssemblyName System.Drawing
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
  Where-Object { $_.MimeType -eq 'image/jpeg' } |
  Select-Object -First 1
if ($null -eq $jpegCodec) { throw 'The JPEG encoder is unavailable.' }
$matte = [System.Drawing.ColorTranslator]::FromHtml($MatteColor)

function Apply-ExifOrientation([System.Drawing.Image]$Image) {
  try {
    $property = $Image.GetPropertyItem(0x0112)
    if ($null -eq $property -or $property.Value.Length -lt 2) { return }
    $orientation = [BitConverter]::ToUInt16($property.Value, 0)
    $rotation = switch ($orientation) {
      2 { [System.Drawing.RotateFlipType]::RotateNoneFlipX }
      3 { [System.Drawing.RotateFlipType]::Rotate180FlipNone }
      4 { [System.Drawing.RotateFlipType]::Rotate180FlipX }
      5 { [System.Drawing.RotateFlipType]::Rotate90FlipX }
      6 { [System.Drawing.RotateFlipType]::Rotate90FlipNone }
      7 { [System.Drawing.RotateFlipType]::Rotate270FlipX }
      8 { [System.Drawing.RotateFlipType]::Rotate270FlipNone }
      default { [System.Drawing.RotateFlipType]::RotateNoneFlipNone }
    }
    if ($rotation -ne [System.Drawing.RotateFlipType]::RotateNoneFlipNone) {
      $Image.RotateFlip($rotation)
    }
  } catch {
    # Images without an orientation tag need no correction.
  }
}

function Save-ResizedJpeg(
  [string]$Source,
  [string]$Destination,
  [int]$MaxSide,
  [int]$Quality
) {
  $sourceImage = [System.Drawing.Image]::FromFile($Source)
  try {
    Apply-ExifOrientation $sourceImage
    $largestSide = [Math]::Max($sourceImage.Width, $sourceImage.Height)
    $scale = [Math]::Min(1.0, [double]$MaxSide / [double]$largestSide)
    $width = [Math]::Max(1, [int][Math]::Round($sourceImage.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($sourceImage.Height * $scale))

    $bitmap = [System.Drawing.Bitmap]::new(
      $width,
      $height,
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.Clear($matte)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $destinationRect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
        $graphics.DrawImage(
          $sourceImage,
          $destinationRect,
          0,
          0,
          $sourceImage.Width,
          $sourceImage.Height,
          [System.Drawing.GraphicsUnit]::Pixel
        )
      } finally {
        $graphics.Dispose()
      }

      $encoderParameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
      try {
        $encoderParameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
          [System.Drawing.Imaging.Encoder]::Quality,
          [long]$Quality
        )
        $bitmap.Save($Destination, $jpegCodec, $encoderParameters)
      } finally {
        $encoderParameters.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $sourceImage.Dispose()
  }
}

function Get-SourcePath([string]$RelativePath) {
  $localPath = $RelativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $localPath))
  if (-not $fullPath.StartsWith($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Photo path escapes the project directory: $RelativePath"
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Missing photo: $RelativePath"
  }
  return $fullPath
}

$gallerySource = [System.IO.File]::ReadAllText($galleryPath, [System.Text.Encoding]::UTF8)
$marker = 'window.GALLERY_DATA ='
$markerIndex = $gallerySource.IndexOf($marker, [System.StringComparison]::Ordinal)
if ($markerIndex -lt 0) { throw 'gallery.js does not contain window.GALLERY_DATA.' }
$jsonText = $gallerySource.Substring($markerIndex + $marker.Length).Trim()
if ($jsonText.EndsWith(';')) { $jsonText = $jsonText.Substring(0, $jsonText.Length - 1) }
$gallery = $jsonText | ConvertFrom-Json

if (Test-Path -LiteralPath $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}
$thumbDirectory = Join-Path $outputRoot 'media\thumb'
$detailDirectory = Join-Path $outputRoot 'media\detail'
New-Item -ItemType Directory -Path $thumbDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $detailDirectory -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $sourceRoot 'config.js') -Destination $outputRoot
Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets') -Destination $outputRoot -Recurse

$buildId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
$indexSource = [System.IO.File]::ReadAllText(
  (Join-Path $sourceRoot 'index.html'),
  [System.Text.Encoding]::UTF8
)
$indexOutput = [regex]::Replace($indexSource, '\?v=[^"''\s>]+', '?v=' + $buildId)
$utf8 = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'index.html'), $indexOutput, $utf8)

foreach ($optionalName in @('favicon.ico', 'robots.txt', 'sitemap.xml', 'CNAME')) {
  $optionalPath = Join-Path $sourceRoot $optionalName
  if (Test-Path -LiteralPath $optionalPath -PathType Leaf) {
    Copy-Item -LiteralPath $optionalPath -Destination $outputRoot
  }
}

$processed = 0
foreach ($item in @($gallery.items)) {
  $sourcePath = Get-SourcePath ([string]$item.file)
  $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.Substring(0, 16).ToLowerInvariant()
  $thumbName = '{0}-{1}-q{2}.jpg' -f $sourceHash, $ThumbnailMaxSide, $ThumbnailQuality
  $detailName = '{0}-{1}-q{2}.jpg' -f $sourceHash, $DetailMaxSide, $DetailQuality
  $thumbPath = Join-Path $thumbDirectory $thumbName
  $detailPath = Join-Path $detailDirectory $detailName

  Save-ResizedJpeg $sourcePath $thumbPath $ThumbnailMaxSide $ThumbnailQuality
  Save-ResizedJpeg $sourcePath $detailPath $DetailMaxSide $DetailQuality

  $item.file = 'media/detail/' + $detailName
  $item | Add-Member -NotePropertyName thumb -NotePropertyValue ('media/thumb/' + $thumbName) -Force
  $processed++
  Write-Host ('[{0}/{1}] {2}' -f $processed, @($gallery.items).Count, $item.title)
}

$gallery | Add-Member -NotePropertyName build -NotePropertyValue ([ordered]@{
  id = $buildId
  thumbnailMaxSide = $ThumbnailMaxSide
  detailMaxSide = $DetailMaxSide
  format = 'jpeg'
}) -Force
$galleryJson = ConvertTo-Json -InputObject $gallery -Depth 8
$galleryOutput = "/* Generated by build.ps1. Do not edit manually. */`r`nwindow.GALLERY_DATA = " +
  $galleryJson + ";`r`n"
[System.IO.File]::WriteAllText((Join-Path $outputRoot 'gallery.js'), $galleryOutput, $utf8)
[System.IO.File]::WriteAllText((Join-Path $outputRoot '.nojekyll'), '', $utf8)

$deploymentBytes = (Get-ChildItem -LiteralPath $outputRoot -Recurse -File |
  Measure-Object -Property Length -Sum).Sum
Write-Host ''
Write-Host ('Deployment build complete: {0}' -f $outputRoot) -ForegroundColor Green
Write-Host ('Optimized photographs: {0}' -f $processed)
Write-Host ('Deployment size: {0:N2} MB' -f ($deploymentBytes / 1MB))
