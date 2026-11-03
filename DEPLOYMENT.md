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

## GitHub Pages (photographs stay local)

The public repository holds the code only. `photos/` and the generated
`gallery.js` are ignored by git, so original files and their metadata are never
committed or uploaded. The published site contains only the resized and
re-encoded copies that the gallery serves to visitors.

1. Put the photographs in `photos/` (subfolders become categories). Remove or
   replace the demo files first if they are still present.
2. Run `./deploy.ps1`. It scans and builds locally, then force-pushes the
   generated `dist/` to the `gh-pages` branch of the `origin` remote. A GitHub
   origin also supplies the canonical site URL (`https://<owner>.github.io/<repo>/`),
   which fills the canonical and `og:image` tags of the static photo pages; pass
   `-SiteUrl` to override it for a custom domain.
3. On the first deployment, open the repository settings, **Pages**, set
   **Source** to **Deploy from a branch**, branch `gh-pages`, folder **/ (root)**.
4. Later deployments are just `./deploy.ps1`.

`.github/workflows/tests.yml` still runs the core and build tests on pushes.
It does not build or deploy the gallery, because the runner has no photographs.

The public page shows the gallery itself; the original files are never in the
repository. GitHub Pages cannot password-protect a site. If the gallery must
not be public, build locally and upload `dist/` to Cloudflare Pages with
Cloudflare Access, or to Netlify/Vercel with their password protection.

If you would rather keep a push-to-deploy flow, a paid GitHub plan can publish
Pages from a private repository (the site is still public), or a private
repository can push `dist/` to the `gh-pages` branch of this public repository
with a token. Both still publish the optimized derivatives that visitors
download.

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
