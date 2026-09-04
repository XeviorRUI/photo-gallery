# My Gallery

A dependency-free photography portfolio built with HTML, CSS, and native JavaScript. The wall fills the viewport, extends horizontally, and supports drag browsing, lazy loading, and a lightbox with camera metadata.

## Project structure

```text
index.html       Main page
config.js        Page title, subtitle visibility, and color theme
assets/style.css Visual design and responsive layout
assets/main.js   Wall layout, dragging, lazy loading, and lightbox behavior
scan.ps1         Photo index generator
build.ps1        Optimized deployment builder
gallery.js       Generated photo index; do not edit by hand
photos/          Photograph assets and category folders
dist/            Generated deployment output; do not edit by hand
```

## Usage

1. Add JPG, JPEG, PNG, GIF, WebP, BMP, TIFF, or AVIF files to `photos/`.
2. Optionally place files in subfolders; each subfolder becomes a category label.
3. Run `scan.ps1` from PowerShell to rebuild `gallery.js` and read image dimensions and EXIF metadata.
4. Open `index.html` in a browser, or serve the folder locally with `python -m http.server 8765`.

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
| Arrow keys / Page Up / Page Down | Move between photographs |
| Escape or click the backdrop | Close the lightbox |

## Customization

- Edit `config.js` to change the site title and subtitle.
- Set `showSubtitle` to `false` to hide the subtitle.
- Set `theme` to `dark` or `light` to select the black or white appearance.
- Adjust wall density in the constants at the top of `assets/main.js`.
- Adjust colors, spacing, and the lightbox animation in `assets/style.css`.

## Notes

`gallery.js` is generated from the contents of `photos/`. After adding, removing, or renaming photographs, run `scan.ps1` again before refreshing the page.
