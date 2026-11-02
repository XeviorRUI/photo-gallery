# Gallery validation

Run from the repository root on Windows:

```powershell
node --test tests/core.test.cjs   # or: node tests/core.test.cjs if the host blocks child-process pipes
./tests/build.tests.ps1
./build.ps1
python tests/prepare-browser-fixtures.py
python tests/serve.py
```

The fixture generator requires Pillow. Open `http://127.0.0.1:8765/tests/browser.html?extended=1` and press **Run integration tests**. Omit `extended=1` for the shorter suite. Failures appear as `FAIL`; completion appears as `DONE`. Keep the tab visible for frame measurements. Production has no Python or Pillow dependency.

## What the tests exercise

- The 0/1/21/200/1000 geometry fixtures repeat the existing assets to isolate layout scale. The original wall coordinates are checked against a saved baseline.
- The distinct fixture contains 1000 different thumbnail/detail pairs with different URLs and bytes. It derives them from the existing photos with numbered overlays, up to 320/960 pixels. It exercises changing network and decode resources, not the visual diversity or resolution of 1000 full-size originals.
- `/__media__/slow/` adds 150 ms before each response and limits each response to 256 KiB/s. This is **per response**, not an aggregate link limit. Ordinary app scripts and styles are unthrottled. Each test uses a fresh media query string for cold loads; cache headers allow warm loads. `/__stats__?run=...` reports requests and bytes actually served for that test.
- Rapid wall travel checks the mounted-node bound, reuse of the same elements for different photos, and image ownership after delayed responses.
- The extended test performs 60 animated directional switches, checks settled node/overlay bounds, closes and reopens the same photograph, and verifies warm reopen adds no HTTP image requests. The duration and traffic are printed, not inferred from catalogue size.
- Gesture tests dispatch touch Pointer Events: left/right, vertical lock, pinch rejection, cancellation, excluded controls, backdrop swipe and backdrop tap. Pure tests cover short flicks and jitter. These do not emulate an operating system's native gesture recognizer.
- Unit tests cover foreground capacity under a full background queue, priority promotion, queue retention while paused, resume, deduplication, eviction, failure, timeout, and cancellation of orphaned in-flight work after the grace period. Build tests cover input protection, cache invalidation, orientation, escaping and rollback.

## Device acceptance still requires hardware

Check iOS Safari and Android Chrome on an actual phone before claiming touch-device coverage: swipe on image and backdrop; vertically scroll long metadata; pinch zoom then pan the zoomed page; use next/previous and close during loading; rotate during animation; background/foreground the tab; enable reduced motion. Repeat a 5-minute browsing session and inspect responsiveness and memory in that browser's profiling tools.

The desktop browser suite reports local frame intervals. Node counts and loader cache budgets do not establish total process, decoded-image or GPU memory bounds. Actual hardware, Safari gesture arbitration, aggregate mobile-network throttling and full-resolution large-library memory profiling are separate acceptance checks.

## Recorded local run — 2026-09-09

Windows, Codex in-app Chromium, 1280 × 720 test viewport (mobile layout at 390 × 844). The 11 core tests, build regression suite, 15 browser checks and the extended sustained-navigation check passed. The shorter browser suite was rerun after the final pointer-capture guard and mutation-budget assertion.

| Measurement | Observed |
| --- | --- |
| Mounted bricks, 21 / 200 / 1000 geometry entries | 91 / 89 / 95 |
| Original visible wall coordinates | Within 0.1 CSS px baseline tolerance |
| Semantic attribute writes over open / switch / close | 136, below the 1000-write regression budget |
| Final local frame sample | 423 intervals; p50 6.1 ms; p95 6.2 ms; none over 25 ms |
| HTTP-throttled 60-switch run | 58.8 s; 189 requests; 6,343,603 served bytes |
| Peak settled nodes in sustained run | 102 bricks, 1 overlay |
| Warm reopen | 0 additional image HTTP requests |
| Final incremental production build | 0 encoded, 105 reused image variants |

These are one-machine observations, not a before/after speedup claim or a mobile performance guarantee. The 60 switches visit a subset of the 1000-resource catalogue.

## Recorded local run — 2026-11-01

Windows, headless Chrome 156 driven over the DevTools protocol, 1280 × 720 test viewport (mobile layout at 390 × 844), local `tests/serve.py`. The 12 core tests, the build regression suite, the 15 browser checks and the extended sustained-navigation soak passed.

| Measurement | Observed |
| --- | --- |
| Mounted bricks, 21 / 200 / 1000 geometry entries | 91 / 89 / 95 |
| Original visible wall coordinates | Within 0.1 CSS px baseline tolerance |
| Semantic attribute writes over open / switch / close | 138, below the 1000-write budget |
| HTTP-throttled 60-switch run | 59.5 s; 189 requests; 6,343,603 served bytes |
| Peak settled nodes in sustained run | 102 bricks, 1 overlay |
| Warm reopen | 0 additional image HTTP requests |
| Local frame intervals (headless) | 97 samples; p50 33.3 ms; p95 33.4 ms; 53 over 25 ms |
| Incremental production build | 0 encoded, 105 reused image variants |
| Matte colour case `#ffffff` vs `#FFFFFF` | Same asset URL and cache entries after normalisation |

The headless compositor's rAF sampling changed between runs (p50 33.3 ms in one run, 6.1 ms in another), so the frame-interval row is **not** comparable to the 2026-09-09 visible-window sample and is not evidence of app performance. The node counts, request and byte totals, warm-reopen and build-reuse results are the comparable figures; request and byte totals match the earlier run. This run did not exercise real iOS Safari or Android Chrome hardware.

## Recorded follow-up — 2026-11-01 (animation mounting)

Repeated the open/close audit with a photograph at the right edge of the screen, which crosses the periodic-normalisation boundary. The pre-fix runtime (the committed `assets/main.js` before the mounting change) and the fixed runtime ran in the same headless Chrome 156 instance (ANGLE D3D11, AMD Radeon) against the 21-photo fixture.

| Measurement | Before | After |
| --- | --- | --- |
| Bricks added at focus settle | 79 | 0 |
| Bricks removed at close start | 79 | 0 |
| Bricks re-added during close | 79 | 0 |
| Longest opening frames | 66.8 / 48.5 / 42.4 ms | 30.4 / 30.3 ms |
| Semantic attribute writes, open + switch + close | 138 | 8 |
| Visible-but-unpainted bricks (per-frame audit) | 0 | 0 |

Zero churn means no tile repaints its placeholder colour (`averageColor`) during open or close. The remaining opening spikes are first-frame raster and decode work. A permanent `will-change: transform` on the wall was also tried across fresh browser launches (3 each): it made the first open slower (206 / 115 / 206 ms) than the shipped code (85 / 103 / 91 ms), so it was not adopted; the first open after a page load still pays a one-off raster cost of tens of milliseconds. The 15 browser checks and the 60-switch soak still pass with the same 189 requests / 6,343,603 bytes and a warm reopen of 0 requests; 26 consecutive right-arrow switches across the catalogue kept every focused photograph painted and inside the viewport with no page exceptions.

## Boundary compositing audit — 2026-11-01

The open and close boundaries were traced with the DevTools `LayerTree` domain:

- The wall keeps one composited layer (stable id) across both boundaries; it is not re-created.
- The lightbox inserts 10 UI layers when the opening starts and removes them when the closing finishes (total layers 14 → 24 → 14).
- At the default texture budget, frame pacing, screencast capture at device scale factors 1 and 2, and blank-frame detection found no uniformly white composited frame in headless Chrome.

## GPU texture-budget audit — 2026-11-01

The compositor was constrained with `--force-gpu-mem-available-mb` and the gallery was opened and closed repeatedly while recording compositor frames (one JPEG per presented frame). A frame counts as blank when its downscaled luminance is nearly uniform and bright (standard deviation < 12, mean > 200) while both neighbours are textured (standard deviation > 25).

| Condition | Cycles | Blank frames |
| --- | --- | --- |
| Default texture budget, previous code | 30 | 0 |
| 128 MB, previous code | 30 | 17 |
| 128 MB, wall kept on its own composited layer | 30 | 0 |
| 64 MB, previous code | 15 | 13 |
| 64 MB, wall kept on its own composited layer | 15 | 3 |
| Default texture budget, composited wall | 15 | 0 |

The white frames are the page background showing through: the zoom makes the compositor allocate a high-resolution tiling for the wall at the start of the flight, and under texture pressure the frame is presented before that raster is ready. Keeping the wall on one long-lived composited layer (`.wall { will-change: transform }`) lets the compositor reuse the existing texture and scale it; the wall sits behind a blurred, veiled backdrop, so the softer zoom is not visible.

Candidates ruled out at 64 MB (15 cycles each, blank frames): removing the backdrop blur 14, hiding the backdrop 12, removing the overlay filter 12, removing brick shadows 15, blocking detail images 11 — all close to the 13-frame baseline.

These budgets are synthetic pressure applied with a command-line flag, not a measurement of any device's GPU memory. Default-budget runs never produced a blank frame. A real device can still present a blank frame for a reason outside these tests; a screen recording or a Performance trace from that device is the next useful artifact.

## Close-end boundary audit — 2026-11-02

The cycle recorder now timestamps the click and the Escape key as well, so blank frames can be attributed to the opening, the focused dwell, the closing animation or the settled wall.

- All remaining blank frames fall **0.83–0.86 s after the close started** (the close animation is 0.82 s); the opening phase produced none.
- The overlay removal, lightbox hide and follow-up teardown now run one frame after the wall's final transform is published. The landing brick sits exactly under the overlay at that moment, so the frame is pixel-identical. At 64 MB this reduced blank frames from 13 to 6 over 40 cycles.
- Deferring the teardown two frames gave 8, and also deferring `cancelAnimation` gave 7, so there was no further gain; the one-frame version was kept for the smallest interaction delay.
- 96 MB: 1–3 blank frames per 30 cycles. 128 MB and the default budget: 0 per 30–40 cycles.

Ruled out at 64 MB (blank frames per 15–40 cycles, repeated baselines 9–13): removing the small glass blurs on buttons and chips (5), hiding the info panel (8), keeping the lightbox subtree mounted instead of toggling `hidden` (6), removing the main backdrop blur (14), hiding the backdrop (12), removing the overlay filter (12), removing brick shadows (15), blocking detail images (11). The differences sit inside the spread of repeated baselines, so none of them is established as the trigger. The residual therefore looks like the compositor's final-frame raster/commit when the whole window's texture budget is below roughly 96 MB, not a page-structure defect.
