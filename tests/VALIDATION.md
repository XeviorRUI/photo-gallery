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
