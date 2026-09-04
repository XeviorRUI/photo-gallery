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

1. Regenerates `gallery.js` with `scan.ps1`.
2. Creates 1080 px JPEG thumbnails at quality 78.
3. Creates 2560 px JPEG detail images at quality 88.
4. Rewrites the deployment index to use the optimized paths.
5. Copies only public runtime files into `dist/`.
6. Adds `.nojekyll` for GitHub Pages.

The generated JPEG files do not retain EXIF metadata. The metadata already
stored in `gallery.js` remains available to the detail panel.

To change the output settings:

```powershell
./build.ps1 -ThumbnailMaxSide 1200 -DetailMaxSide 3000 `
  -ThumbnailQuality 80 -DetailQuality 90 -MatteColor '#FFFFFF'
```

`MatteColor` is used only when a source image contains transparency. Use
`#FFFFFF` for the light theme or `#000000` for the dark theme.

## GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` builds and publishes
`dist/` whenever the `main` branch is updated. In the repository settings, open
**Pages** and set **Source** to **GitHub Actions**.

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

