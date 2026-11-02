const { test } = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../assets/layout.js');
const images = require('../assets/image-loader.js');
const catalog = require('../assets/catalog.js');
const scenes = require('../assets/scene.js');
const swipes = require('../assets/swipe.js');

test('scene transitions cancel previous ownership and reject illegal jumps', () => {
  const scene = scenes.create();
  assert.throws(() => scene.begin('switching'), /Invalid scene transition/);
  const first = scene.begin('opening'), oldSignal = scene.signal;
  scene.set('focused'); scene.begin('switching');
  assert.ok(oldSignal.aborted); assert.ok(scene.token > first);
  scene.begin('closing'); scene.set('wall');
  assert.equal(scene.mode, 'wall');
});

test('virtual geometry matches the original repeated wall, including negative cycles', () => {
  const widths = [40, 140, 219, 86, 420];
  const rows = [{ row: -1, offset: 4, y: -100, decorative: true }, { row: 0, offset: 0, y: 20 }, { row: 1, offset: 2, y: 140 }];
  const model = layout.create(widths, rows, 108, 12, 18);
  for (const row of rows) for (let cycle = -3; cycle <= 3; cycle++) {
    let x = 18 + cycle * model.cycleWidth;
    for (let i = 0; i < widths.length; i++) {
      const pos = (row.offset + i) % widths.length;
      const brick = model.copy(row.row, pos, cycle);
      assert.equal(brick.x, x); assert.equal(brick.w, widths[pos]);
      x += widths[pos] + 12;
    }
  }
  for (let left = -2000; left < 2000; left += 41) {
    const right = left + 640;
    const expected = [];
    for (const row of rows) for (let ordinal = -30; ordinal < 30; ordinal++) {
      const b = model.at(row.row, ordinal);
      if (b.x + b.w >= left && b.x <= right) expected.push(b.key);
    }
    assert.deepEqual(model.query(left, right).map(b => b.key).sort(), expected.sort());
  }
});

test('one image covers a wide viewport; 1000 images keep the same visible geometry count', () => {
  const rows = Array.from({ length: 6 }, (_, row) => ({ row, offset: 0, y: row * 142 }));
  const counts = [1, 21, 200, 1000, 10000].map(n => {
    const m = layout.create(Array(n).fill(190), rows, 130, 12, 18);
    const visible = m.query(m.cycleWidth - 538, m.cycleWidth + 1818);
    for (let row = 0; row < 6; row++) {
      const line = visible.filter(b => b.row === row);
      assert.ok(line[0].x <= m.cycleWidth - 538);
      assert.ok(line.at(-1).x + line.at(-1).w >= m.cycleWidth + 1818);
    }
    return visible.length;
  });
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 6);
  assert.ok(Math.max(...counts) < 90);
});

test('multi-step navigation is exact across many cycle boundaries', () => {
  const m = layout.create([80, 160, 240], [{ row: 0, offset: 1, y: 0 }], 100, 12, 18);
  const a = m.at(0, 1);
  const b = m.at(0, 1 + 30000);
  assert.equal(b.orderPos, a.orderPos);
  assert.equal(b.x - a.x, m.cycleWidth * 10000);
});

test('stride dealing spreads one viewport across the catalogue without repeats', () => {
  const count = 200;
  const widths = Array.from({ length: count }, (_, i) => 60 + (i % 7) * 18);
  const rows = [];
  for (let row = -1; row <= 4; row++) {
    rows.push({ row, offset: row, stride: 7, y: row * 140, decorative: row < 0 || row === 4 });
  }
  const model = layout.create(widths, rows, 120, 12, 18);
  assert.equal(model.cycleWidth, widths.reduce((sum, w) => sum + w + 12, 0));
  for (const row of rows) {
    const seen = new Set();
    for (let i = 0; i < count; i++) seen.add(model.at(row.row, i).orderPos);
    assert.equal(seen.size, count, 'a row must still contain the whole catalogue');
  }
  const window = [];
  for (let column = 0; column < 14; column++) {
    for (const row of rows) window.push(model.at(row.row, column).orderPos);
  }
  assert.equal(new Set(window).size, window.length, 'one viewport must not repeat a photograph');
  for (const row of rows) {
    for (const orderPos of [0, 1, 17, 199]) {
      const brick = model.copy(row.row, orderPos, 2);
      assert.equal(brick.orderPos, orderPos);
      assert.equal(model.at(row.row, brick.ordinal).orderPos, orderPos);
    }
  }
  // A stride that is not coprime would repeat the row; the geometry falls back.
  const fallback = layout.create(widths, [{ row: 0, offset: 0, stride: 6, y: 0 }], 120, 12, 18);
  assert.equal(fallback.at(0, 1).orderPos, 1);
});

test('stable ordering, curated ordering, unavailable storage and size selection', () => {
  const items = catalog.normalize({ items: [{ file: 'a', width: 20, height: 40, order: 2 }, { file: 'b', order: 1 }] });
  assert.deepEqual(catalog.shuffledIndices(items, 42), catalog.shuffledIndices(items, 42));
  assert.deepEqual(catalog.shuffledIndices(items, 42, true), [1, 0]);
  assert.equal(catalog.read(null, 'x'), null); catalog.write(null, 'x', {});
  assert.equal(images.source({ thumbnails: [{ side: 640, file: 'medium' }, { side: 320, file: 'small' }] }, 400, false), 'medium');
});

function fakeImages() {
  const started = [];
  return { started, makeImage() {
    return { naturalWidth: 10, naturalHeight: 10, decode: () => Promise.resolve(),
      set src(value) { this._src = value; started.push(this); },
      get src() { return this._src; }, removeAttribute() {} };
  } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('loader limits concurrency, prioritizes current images, deduplicates and evicts', async () => {
  const fake = fakeImages();
  const loader = images.create({ makeImage: fake.makeImage, concurrency: 1, maxEntries: 1, hidden: () => false });
  const a = loader.load('a', 1); const same = loader.load('a', 0);
  assert.equal(a, same);
  const b = loader.load('b', 2); const c = loader.load('c', 0);
  assert.equal(fake.started.length, 1);
  fake.started[0].onload(); await a; await tick();
  assert.equal(fake.started[1].src, 'c');
  fake.started[1].onload(); await c; await tick();
  assert.equal(fake.started[2].src, 'b');
  fake.started[2].onload(); await b;
  assert.equal(loader.stats().entries, 1); assert.equal(loader.stats().pixels, 100);
  loader.dispose();
});

test('loader drops obsolete queued work and recovers from timeout and error', async () => {
  const fake = fakeImages();
  const loader = images.create({ makeImage: fake.makeImage, concurrency: 1, timeout: 25, hidden: () => false });
  const a = loader.load('stuck'); const b = loader.load('obsolete');
  const obsolete = assert.rejects(b, { name: 'AbortError' });
  loader.prune(new Set(['stuck'])); await obsolete;
  await assert.rejects(a, /timed out/);
  const retry = loader.load('stuck'); fake.started.at(-1).onerror();
  await assert.rejects(retry, /unavailable/);
  assert.equal(loader.stats().running, 0); loader.dispose();
});

test('prune cancels orphaned in-flight work after the grace period and frees its slot', async () => {
  const fake = fakeImages();
  let now = 1000;
  const loader = images.create({ makeImage: fake.makeImage, concurrency: 3, staleGrace: 100,
    clock: () => now, hidden: () => false });
  const kept = loader.load('kept');
  const orphan = loader.load('orphan');
  const orphanRejection = assert.rejects(orphan, { name: 'AbortError' });
  assert.equal(fake.started.length, 2, 'Both requests start under the concurrency limit');

  now = 1050; loader.prune(new Set(['kept']));
  assert.equal(loader.stats().running, 2, 'A just-orphaned request keeps its slot during the grace period');
  now = 1100; loader.prune(new Set(['kept', 'orphan']));
  now = 1200; loader.prune(new Set(['kept']));
  assert.equal(loader.stats().running, 2, 'A returning consumer restarts the grace period');

  const waiting = loader.load('waiting');
  assert.equal(fake.started.length, 2, 'Queued work must wait for a free slot');
  now = 1300; loader.prune(new Set(['kept', 'waiting']));
  await orphanRejection;
  assert.equal(loader.stats().cancelled, 1);
  assert.equal(loader.stats().running, 2, 'Cancelling the orphan released its slot');
  assert.equal(fake.started.length, 3);
  assert.equal(fake.started[2].src, 'waiting');
  fake.started[0].onload(); fake.started[2].onload();
  await kept; await waiting; loader.dispose();
});

test('release drops a cached or pending image so it is loaded again', async () => {
  const fake = fakeImages();
  const loader = images.create({ makeImage: fake.makeImage, concurrency: 1, hidden: () => false });
  const first = loader.load('kept');
  fake.started[0].onload();
  await first;
  assert.equal(loader.stats().entries, 1);
  assert.equal(loader.release('kept'), true);
  assert.equal(loader.stats().entries, 0);
  const second = loader.load('kept');
  assert.equal(fake.started.length, 2, 'a released image must be requested again');
  fake.started[1].onload();
  await second;
  assert.equal(loader.stats().entries, 1);
  const pending = loader.load('pending');
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  assert.equal(loader.release('pending'), true);
  await rejected;
  assert.equal(loader.stats().running, 0);
  assert.equal(loader.release('missing'), false);
  loader.dispose();
});

test('background work pauses while hidden; foreground requests can still run', async () => {
  const fake = fakeImages(); let hidden = true;
  const loader = images.create({ makeImage: fake.makeImage, hidden: () => hidden });
  const warm = loader.load('warm', 2);
  assert.equal(fake.started.length, 0);
  const current = loader.load('current', 0); fake.started[0].onload(); await current;
  hidden = false; loader.resume(); fake.started[1].onload(); await warm;
  loader.dispose();
});

test('current image has reserved capacity and background promotion changes priority', async () => {
  const fake = fakeImages();
  const loader = images.create({ makeImage: fake.makeImage, hidden: () => false });
  const work = ['a', 'b', 'c', 'd'].map(src => loader.load(src, 2));
  assert.equal(fake.started.length, 3);
  const foreground = loader.load('current', 0);
  assert.equal(fake.started[3].src, 'current');
  loader.load('a', 0);
  assert.equal(fake.started[0].fetchPriority, 'high');
  for (const image of [...fake.started]) image.onload();
  await foreground; await tick();
  fake.started[4].onload(); await Promise.all(work); loader.dispose();
});

test('pause preserves queued promises for mounted thumbnails on resume', async () => {
  const fake = fakeImages();
  const loader = images.create({ makeImage: fake.makeImage, concurrency: 1, hidden: () => false });
  const a = loader.load('a'), b = loader.load('b');
  loader.pause(); fake.started[0].onload(); await a;
  assert.equal(fake.started.length, 1);
  loader.resume(); fake.started[1].onload(); await b;
  assert.equal(loader.stats().queued, 0); loader.dispose();
});

test('swipe direction, flick, jitter, vertical lock, pinch and cancellation', () => {
  const swipe = swipes.create();
  const start = () => swipe.down(1, 200, 200, 0, 390);
  start(); assert.equal(swipe.up(1, 100, 210, 500).direction, 1);
  start(); assert.equal(swipe.up(1, 300, 200, 500).direction, -1);
  start(); assert.equal(swipe.up(1, 168, 200, 60).direction, 1);
  start(); assert.equal(swipe.up(1, 195, 202, 100).tap, true);
  start(); swipe.move(1, 204, 230); assert.equal(swipe.up(1, 80, 250, 300).direction, 0);
  start(); swipe.down(2, 220, 200, 20, 390); assert.equal(swipe.up(1, 100, 200, 200), null);
  assert.equal(swipe.up(2, 300, 200, 200), null);
  start(); swipe.cancel(1); assert.equal(swipe.up(1, 100, 200, 200), null);
  swipe.down(1, 200, 200, 0, 390, false); assert.equal(swipe.up(1, 100, 200, 200), null);
});
