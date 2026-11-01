# My Gallery

A dependency-free photography portfolio built with HTML, CSS, and native JavaScript. The wall fills the viewport, extends horizontally, and supports drag browsing, lazy loading, and a lightbox with camera metadata.

## Project structure

```text
index.html       Main page
config.js        Page title, subtitle visibility, and color theme
assets/style.css Visual design and responsive layout
assets/main.js   Scene controller, virtual wall mounting, input and animation
assets/layout.js Pure periodic geometry and binary-search viewport queries
assets/image-loader.js Prioritized loading, decoding and bounded LRU cache
assets/catalog.js Catalogue validation and deterministic ordering
assets/scene.js  Legal scene transitions and cancellation ownership
assets/swipe.js  Direction-locked single-finger lightbox gestures
catalog.json    Optional author-managed titles, stories, IDs, tags and ordering
scan.ps1         Photo index generator
build.ps1        Optimized deployment builder
gallery.js       Generated photo index; do not edit by hand
photos/          Photograph assets and category folders
dist/            Generated deployment output; do not edit by hand
```

## Usage

1. Add JPG, JPEG, PNG, GIF, BMP or TIFF files to `photos/`. The Windows image pipeline uses the first GIF frame / TIFF page. Convert WebP and AVIF first; unsupported or damaged images fail production builds instead of silently disappearing.
2. Optionally place files in subfolders; each subfolder becomes a category label.
3. Run `scan.ps1` from PowerShell to rebuild `gallery.js` and read image dimensions and EXIF metadata.
4. Open `index.html` in a browser, or serve the folder locally with `python -m http.server 8765 --bind 127.0.0.1`. Source preview uses originals. For optimized preview, run `./build.ps1` and visit `/dist/`.

## Production build

Run `./build.ps1` to create an isolated `dist/` directory containing optimized
thumbnail and detail images plus only the files required by the public site.
See `DEPLOYMENT.md` for GitHub Pages and Nginx instructions.

## Controls

| Action | Result |
| --- | --- |
| Drag left or right | Browse the photo wall with inertia |
| Scroll vertically | Browse the photo wall horizontally with acceleration |
| Click a photograph | Open the animated lightbox and metadata |
| Swipe left / right on an open photograph or backdrop | Next / previous photograph; vertical gestures and pinch remain native |
| Arrow keys / Page Up / Page Down | Move between photographs |
| Escape or click the backdrop | Close the lightbox |
| Tab, then arrow keys and Enter | Explore and open photographs using the keyboard |
| Browser Back / Forward | Leave / return to a linked photograph |

## Customization

- Edit `config.js` to change the site title and subtitle.
- Set `showSubtitle` to `false` to hide the subtitle.
- Set `theme` to `dark` or `light` to select the black or white appearance.
- Set `showShare` or `showCollections` to `true` for optional sharing and collection controls. Both default to `false`.
- Copy the structure in `catalog.example.json` into `catalog.json`, using your own photo paths. Metadata is never written back into source photographs.
- Set `order` to `curated` to use numerical `order` values. The default shuffled order and wall position are remembered within the browser tab session.
- Link to a collection with `?collection=Landscape`, or to a photo with `#photo=ID`. Photo IDs default to a content hash (survives renaming); assign a custom ID to preserve a link after editing the photo, or distinguish identical copies.
- `?seed=42` selects a repeatable shuffle, useful for visual comparisons.
- Adjust wall density in the constants at the top of `assets/main.js`.
- Adjust colors, spacing, and the lightbox animation in `assets/style.css`.

## Notes

Photo placeholders use the arithmetic mean of every full-resolution pixel's RGB channels, computed during scanning/building and stored as `averageColor`. Transparent pixels are composited over `MatteColor` (white by default) before averaging. Results are cached by image content and matte colour; the browser does not download or decode extra images to compute placeholders. Run `scan.ps1` to refresh source preview metadata, or `build.ps1` for deployment. Older catalogues without a valid average colour use a neutral grey fallback.

`gallery.js` is generated from the contents of `photos/`. After adding, removing, or renaming photographs, run `scan.ps1` again before refreshing the page.

## Validation

Run `node --test tests/core.test.cjs` (Node 18+) and `./tests/build.tests.ps1` on Windows. Build tests create isolated, retained fixtures under `.work/` and exercise output protection, incremental reuse and failure recovery.

After building, run `python tests/prepare-browser-fixtures.py` (requires Pillow), then `python tests/serve.py` and open `http://127.0.0.1:8765/tests/browser.html?extended=1`. The server binds to localhost only. See [tests/VALIDATION.md](tests/VALIDATION.md) for fixture scope, throttling and device checks.
