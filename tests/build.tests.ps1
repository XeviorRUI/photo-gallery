$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path $projectRoot ('.work/build-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'photos'),(Join-Path $fixture 'assets') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'build.ps1'),(Join-Path $projectRoot 'scan.ps1'),(Join-Path $projectRoot 'index.html'),(Join-Path $projectRoot 'config.js') -Destination $fixture
Copy-Item -LiteralPath (Join-Path $projectRoot 'average-color.ps1') -Destination $fixture
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'assets') -File | Copy-Item -Destination (Join-Path $fixture 'assets')
Add-Type -AssemblyName System.Drawing
. (Join-Path $projectRoot 'average-color.ps1')
$pixels = [Drawing.Bitmap]::new(3,1)
try {
  $pixels.SetPixel(0,0,[Drawing.Color]::Red)
  $pixels.SetPixel(1,0,[Drawing.Color]::Lime)
  $pixels.SetPixel(2,0,[Drawing.Color]::Blue)
  if ([GalleryPixelAverage]::Compute($pixels,[Drawing.Color]::White) -ne '#555555') {
    throw 'RGB mean must include all three pixels, excluding row padding.'
  }
} finally { $pixels.Dispose() }
$bitmap = [Drawing.Bitmap]::new(40,60)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([Drawing.Color]::Transparent)
$graphics.FillRectangle([Drawing.Brushes]::Red,10,10,20,20)
$bitmap.Save((Join-Path $fixture 'photos/sample.png'),[Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()

function Assert([bool]$Condition,[string]$Message) { if (-not $Condition) { throw $Message } }
function Read-Gallery([string]$Path) {
  $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  return ($text.Split(@('window.GALLERY_DATA ='),[StringSplitOptions]::None)[1].Trim().TrimEnd(';') | ConvertFrom-Json)
}
& (Join-Path $fixture 'scan.ps1') -Root $fixture
$sourceIndex = Join-Path $fixture 'gallery.js'
$sourceHash = (Get-FileHash -LiteralPath $sourceIndex).Hash
$photoHash = (Get-FileHash -LiteralPath (Join-Path $fixture 'photos/sample.png')).Hash
foreach ($unsafe in @('photos','assets','.git','tests','../outside','nested/output')) {
  $failed = $false
  try { & (Join-Path $fixture 'build.ps1') -Root $fixture -Output $unsafe } catch { $failed = $true }
  Assert $failed "Unsafe output was accepted: $unsafe"
}
Assert ((Get-FileHash -LiteralPath $sourceIndex).Hash -eq $sourceHash) 'Guard modified source index.'
Assert ((Get-FileHash -LiteralPath (Join-Path $fixture 'photos/sample.png')).Hash -eq $photoHash) 'Guard modified source photo.'
Write-Host 'PASS output guards execute before modifying inputs'

$unknown = Join-Path $fixture 'unowned'
New-Item -ItemType Directory -Path $unknown | Out-Null
Set-Content -LiteralPath (Join-Path $unknown 'keep.txt') -Value 'keep'
$failed = $false
try { & (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'unowned' } catch { $failed = $true }
Assert $failed 'Unowned directory was accepted.'
Assert (Test-Path -LiteralPath (Join-Path $unknown 'keep.txt')) 'Unowned data was removed.'
Write-Host 'PASS unowned output is preserved'

& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' -SiteUrl 'https://example.org/gallery/'
$first = Read-Gallery (Join-Path $fixture 'public/gallery.js')
Assert ($first.items[0].averageColor -eq '#FFD5D5') 'Average must include every pixel, composited on white.'
Assert ((Get-FileHash -LiteralPath $sourceIndex).Hash -eq $sourceHash) 'Build rewrote source index.'
Assert ($first.items[0].thumbnails.Count -eq 3) 'Missing thumbnail sizes.'
Assert ($first.items[0].details.Count -eq 2) 'Missing detail sizes.'
Assert (Test-Path -LiteralPath (Join-Path $fixture ('public/' + $first.items[0].thumb))) 'Custom output paths are broken.'
$cacheFiles = @(Get-ChildItem -LiteralPath (Join-Path $fixture '.gallery-cache/images-v2') -File)
$times = @{}; foreach ($f in $cacheFiles) { $times[$f.Name] = $f.LastWriteTimeUtc.Ticks }
$metadataFiles = @(Get-ChildItem -LiteralPath (Join-Path $fixture '.gallery-cache/exif-average-v2') -File)
$metadataTimes = @{}; foreach ($f in $metadataFiles) { $metadataTimes[$f.Name] = $f.LastWriteTimeUtc.Ticks }
& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public'
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $fixture '.gallery-cache/exif-average-v2') -File) {
  Assert ($f.LastWriteTimeUtc.Ticks -eq $metadataTimes[$f.Name]) 'Unchanged average colour was recomputed.'
}
foreach ($f in Get-ChildItem -LiteralPath (Join-Path $fixture '.gallery-cache/images-v2') -File) {
  Assert ($f.LastWriteTimeUtc.Ticks -eq $times[$f.Name]) 'Unchanged image was encoded again.'
}
Write-Host 'PASS custom output, separate source index, responsive variants and incremental reuse'

& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' -MatteColor '#ffffff'
$lowered = Read-Gallery (Join-Path $fixture 'public/gallery.js')
Assert ($lowered.items[0].thumb -eq $first.items[0].thumb) 'Matte colour case changed the asset URL.'
Assert ($lowered.items[0].averageColor -eq $first.items[0].averageColor) 'Matte colour case changed the average colour.'
Assert (@(Get-ChildItem -LiteralPath (Join-Path $fixture '.gallery-cache/images-v2') -File).Count -eq $times.Count) 'Matte colour case re-encoded identical variants.'
Write-Host 'PASS matte colour case is normalised before hashing'

& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' -MatteColor '#000000'
$black = Read-Gallery (Join-Path $fixture 'public/gallery.js')
Assert ($black.items[0].averageColor -eq '#2B0000') 'Average colour did not follow the black matte.'
Assert ($first.items[0].thumb -ne $black.items[0].thumb) 'Matte change reused the same cache URL.'
$image = [Drawing.Bitmap]::new((Join-Path $fixture ('public/' + $black.items[0].thumb)))
try { Assert ($image.GetPixel(0,0).R -lt 20) 'Matte background did not change.' } finally { $image.Dispose() }
Write-Host 'PASS matte parameter changes both URL and image pixels'
& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' -MatteColor '#000000' -SkipScan
$skip = Read-Gallery (Join-Path $fixture 'public/gallery.js')
Assert ($skip.items[0].averageColor -eq '#2B0000') 'SkipScan kept an average for the wrong matte.'
Write-Host 'PASS full-pixel average, cached reuse and SkipScan matte correction'

# A JPEG containing a minimal EXIF orientation=6 record should become 60x40.
$oriented = [Drawing.Bitmap]::new(40,60)
$stream = [IO.MemoryStream]::new()
try { $oriented.Save($stream,[Drawing.Imaging.ImageFormat]::Jpeg); $jpeg = $stream.ToArray() }
finally { $oriented.Dispose(); $stream.Dispose() }
[byte[]]$exif = @(255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0)
[byte[]]$withExif = @($jpeg[0..1]) + @($exif) + @($jpeg[2..($jpeg.Length-1)])
[IO.File]::WriteAllBytes((Join-Path $fixture 'photos/oriented.jpg'),$withExif)
[IO.File]::WriteAllText((Join-Path $fixture 'catalog.json'),'{"sample.png":{"id":"sample-story","title":"<script>test</script>","description":"A & B","tags":["Selected"],"order":1}}')
& (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' -SiteUrl 'https://example.org/gallery/'
$enriched = Read-Gallery (Join-Path $fixture 'public/gallery.js')
$rotated = @($enriched.items | Where-Object { $_.title -eq 'oriented' })[0]
Assert ($rotated.width -eq 60 -and $rotated.height -eq 40) 'EXIF dimensions are not oriented.'
$image = [Drawing.Bitmap]::new((Join-Path $fixture ('public/' + $rotated.file)))
try { Assert ($image.Width -eq 60 -and $image.Height -eq 40) 'Output pixels are not oriented.' } finally { $image.Dispose() }
$story = Get-Content -LiteralPath (Join-Path $fixture 'public/photo/sample-story.html') -Raw
Assert ($story.Contains('&lt;script&gt;') -and -not $story.Contains('<script>')) 'Photo story HTML was not escaped.'
Assert ($story.Contains('https://example.org/gallery/media/')) 'Share preview lost the project subpath.'
Write-Host 'PASS EXIF orientation, editable content, escaped static pages and absolute sharing metadata'

$deployedIndex = Join-Path $fixture 'public/gallery.js'
$deployedHash = (Get-FileHash -LiteralPath $deployedIndex).Hash
[IO.File]::WriteAllText((Join-Path $fixture 'photos/broken.avif'),'not an image')
$failed = $false
try { & (Join-Path $fixture 'build.ps1') -Root $fixture -Output 'public' } catch { $failed = $true }
Assert $failed 'Undecodable input should fail a production build.'
Assert ((Get-FileHash -LiteralPath $deployedIndex).Hash -eq $deployedHash) 'Failed build damaged previous deployment.'
Assert ((Get-FileHash -LiteralPath $sourceIndex).Hash -eq $sourceHash) 'Failed build rewrote source index.'
Write-Host 'PASS failed build preserves previous deployment and source index'
Write-Host ('Build regression tests passed. Fixture retained at ' + $fixture)
