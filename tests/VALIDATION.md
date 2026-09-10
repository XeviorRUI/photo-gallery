# Gallery validation

Run from the repository root on Windows:

```powershell
node --test tests/core.test.cjs
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
- Unit tests cover foreground capacity under a full background queue, priority promotion, queue retention while paused, resume, deduplication, eviction, failure and timeout. Build tests cover input protection, cache invalidation, orientation, escaping and rollback.

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
