# Deployment

The gallery is deployed as a static website. The source photographs remain in
`photos/`, while `build.ps1` creates optimized browser assets in an isolated
`dist/` directory.

## Build locally

Run the following command from PowerShell:

```powershell
./build.ps1
```

The build performs these steps:

1. Validates output ownership and paths, then scans into a staging directory. The source `gallery.js` is not modified.
2. Creates 320/640/1080 px JPEG thumbnails at quality 78.
3. Creates 1600/2560 px JPEG detail images at quality 88.
4. Rewrites the deployment index to use the optimized paths.
5. Copies only public runtime files into `dist/`.
6. Adds standalone `photo/ID.html` pages and `.nojekyll` for GitHub Pages.
7. Promotes the complete output, retaining the previous deployment if generation fails. Replacement uses same-volume directory moves with rollback; it is not a zero-downtime server deployment mechanism.

Original images are decoded once per changed photo when generating variants. EXIF and encoded image caches live in `.gallery-cache/`; image keys include source content, dimensions, quality, matte color, orientation/color strategy and encoder version. Unchanged assets are reused. JavaScript/CSS versions use content hashes. The cache is local and can be discarded when no build is running; it is never published.

`-Output public` creates another direct child of the project. Input directories, linked paths and existing directories without the build ownership marker are rejected. The old generated `dist` format is migrated automatically after validation. Builds for one project are serialized by a file lock.

Images are oriented before resizing, loaded with embedded color management, flattened against `MatteColor`, and emitted as JPEG without embedded metadata. JPEG remains the default to preserve the established rendering; WebP/AVIF are not advertised as supported inputs by this pipeline.

For absolute social preview metadata, supply the public base URL, including any project subpath:

```powershell
./build.ps1 -SiteUrl 'https://example.com/my-gallery/'
```

When `showShare` is enabled, the production permalink points to the standalone photo page, which has a link back into the animated gallery. Without `SiteUrl`, static photo pages still work, but absolute Open Graph image URLs are omitted.

The generated JPEG files do not retain EXIF metadata. The metadata already
stored in `gallery.js` remains available to the detail panel.

To change the output settings:

```powershell
./build.ps1 -ThumbnailMaxSide 1200 -DetailMaxSide 3000 `
  -ThumbnailQuality 80 -DetailQuality 90 -MatteColor '#FFFFFF'
```

`MatteColor` is used only when a source image contains transparency. Use
`#FFFFFF` for the light theme or `#000000` for the dark theme. The colour is
normalised to upper case before hashing, so `#ffffff` and `#FFFFFF` share cache
entries, asset URLs and the stored placeholder average.

## GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` builds and publishes
`dist/` whenever the `main` branch is updated. In the repository settings, open
**Pages** and set **Source** to **GitHub Actions**.

The build steps run under Windows PowerShell 5.1 rather than PowerShell 7. The
image pipeline uses `System.Drawing` (GDI+) and `ImageCodecInfo`, which come from
the .NET Framework assemblies that 5.1 provides; PowerShell 7 only carries a
facade that forwards those types to a separate `System.Drawing.Common` package.
Running the same commands under 5.1 matches the local development host.

If the source repository is public, the original files in `photos/` are also
publicly visible in the repository even though they are not part of the Pages
artifact. To keep originals private, use an eligible private repository or run
the build locally and publish only `dist/` from a separate Pages repository.

## Nginx

Copy the completed `dist/` directory to the server, for example:

```text
/var/www/my-gallery/dist
```

Copy `deploy/nginx.conf.example` into the Nginx configuration directory, then
replace the example domain, document root, and certificate paths. The template
includes HTTPS redirection, compression, cache rules, disabled directory
listing, and basic security headers.

## Files that belong on the public server

Only publish the contents of `dist/`. Development files such as `scan.ps1`,
`build.ps1`, `README.md`, `DEPLOYMENT.md`, and `bugs.md` are intentionally not
copied there.
