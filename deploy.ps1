#requires -Version 5.1
<#
  ============================================================
  deploy.ps1 - build locally and publish the gallery
  ------------------------------------------------------------
  Scans the photographs in photos/, builds dist/, and force-pushes that
  directory to the gh-pages branch of the origin remote. Original files are
  never committed or uploaded; the branch contains only the optimized copies
  that the gallery serves to visitors.

  Usage:
    ./deploy.ps1
    ./deploy.ps1 -Message 'Autumn update'
    ./deploy.ps1 -RemoteUrl https://github.com/user/site.git
    ./deploy.ps1 -SiteUrl https://example.com/gallery/

  The canonical site URL is derived from a GitHub origin remote unless
  -SiteUrl is passed; it fills the canonical and og:image tags of the static
  photo pages.

  First deployment: after the branch exists, open the repository settings,
  Pages, and choose "Deploy from a branch" -> gh-pages -> / (root).
  ============================================================
#>
[CmdletBinding()]
param(
  [string]$Message = '',
  [string]$RemoteUrl = '',
  [string]$SiteUrl = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
$root = [IO.Path]::GetFullPath($root)

$photos = Join-Path $root 'photos'
if (-not (Test-Path -LiteralPath $photos)) {
  throw "photos/ was not found under $root."
}

$extensions = @('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif')
$images = @(Get-ChildItem -LiteralPath $photos -Recurse -File |
  Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() })
if ($images.Count -eq 0) {
  throw "No images found under $photos. Add your photographs or remove the demo files first."
}

$demoDir = Join-Path $photos 'demo'
if (Test-Path -LiteralPath $demoDir) {
  $demoImages = @(Get-ChildItem -LiteralPath $demoDir -Recurse -File |
    Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() })
  if ($demoImages.Count -gt 0) {
    Write-Warning ("photos/demo still contains {0} demo image(s); they will be published unless you remove them." -f $demoImages.Count)
  }
}

Write-Host ("Scanning {0} local images..." -f $images.Count) -ForegroundColor Cyan
& (Join-Path $root 'scan.ps1') -Root $root

if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
  $RemoteUrl = (git -C $root remote get-url origin 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($RemoteUrl)) {
    throw 'No origin remote found; pass -RemoteUrl explicitly.'
  }
}
if ([string]::IsNullOrWhiteSpace($SiteUrl) -and
    $RemoteUrl -match 'github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$') {
  $owner = $matches[1].ToLowerInvariant()
  $repo = $matches[2].ToLowerInvariant()
  if ($repo -eq ($owner + '.github.io')) { $SiteUrl = "https://$owner.github.io/" }
  else { $SiteUrl = "https://$owner.github.io/$repo/" }
  Write-Host ("Canonical site URL: {0}" -f $SiteUrl) -ForegroundColor DarkGray
}

Write-Host 'Building the deployment directory...' -ForegroundColor Cyan
$buildArgs = @{ Root = $root }
if (-not [string]::IsNullOrWhiteSpace($SiteUrl)) { $buildArgs['SiteUrl'] = $SiteUrl }
& (Join-Path $root 'build.ps1') @buildArgs

$dist = Join-Path $root 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $dist 'gallery.js'))) {
  throw 'The build did not produce dist/gallery.js.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dist '.nojekyll'))) {
  throw 'The build did not produce dist/.nojekyll; the branch deployment needs it.'
}

if ([string]::IsNullOrWhiteSpace($Message)) {
  $Message = 'Deploy gallery ' + (Get-Date).ToString('yyyy-MM-dd HH:mm')
}

$staging = Join-Path ([IO.Path]::GetTempPath()) ('gallery-gh-pages-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  # -Force includes dotfiles such as .nojekyll, which the branch deployment needs.
  Get-ChildItem -LiteralPath $dist -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $staging -Recurse -Force
  }

  Push-Location $staging
  # git prints progress and line-ending warnings on stderr; with ErrorActionPreference
  # set to Stop, PowerShell 5.1 turns those into terminating errors. Run the git
  # block with Continue and check every exit code instead.
  $gitEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    git init -q 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
    git checkout -q -b gh-pages 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git checkout -b gh-pages failed.' }
    git add -A 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
    git -c user.name='gallery-deploy' -c user.email='gallery-deploy@localhost' commit -qm $Message 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
    git remote add origin $RemoteUrl 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git remote add failed.' }
    git push --force origin gh-pages 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }
  } finally {
    $ErrorActionPreference = $gitEap
    Pop-Location
  }
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Published dist/ to the gh-pages branch.' -ForegroundColor Green
Write-Host 'First deployment only: Settings -> Pages -> Source: Deploy from a branch'
Write-Host '  Branch: gh-pages    Folder: / (root)'
