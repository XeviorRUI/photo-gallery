/* Integration tests interact through the page's DOM and ordinary input events. */
'use strict';
const results = document.querySelector('#results');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function until(predicate, label, timeout = 12000) {
  const end = performance.now() + timeout;
  while (!predicate()) { if (performance.now() > end) throw new Error('Timeout: ' + label); await pause(20); }
}
async function load(name) {
  sessionStorage.removeItem('gallery:/.work/cases/' + name + '.html');
  const frame = document.createElement('iframe');
  frame.src = '/.work/cases/' + name + '.html?seed=42&run=' + Date.now();
  document.querySelector('#fixtures').appendChild(frame);
  await new Promise(resolve => frame.onload = resolve);
  return frame;
}
function visibleBricks(doc) {
  return [...doc.querySelectorAll('.brick')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.right > 0 && r.left < doc.defaultView.innerWidth && r.bottom > 0 && r.top < doc.defaultView.innerHeight;
  });
}
function photo(doc) {
  const candidates = visibleBricks(doc).filter(el => !el.classList.contains('decorative'));
  return candidates.find(el => el.getBoundingClientRect().left > 0) || candidates[0];
}
function key(doc, value, shiftKey = false) { doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })); }
function mode(doc) { return doc.querySelector('#stage').dataset.mode; }
function pointer(doc, target, type, x, y, id = 1) {
  target.dispatchEvent(new doc.defaultView.PointerEvent(type, { pointerType: 'touch', pointerId: id,
    isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
}
function swipePhoto(doc, direction, target = doc.querySelector('.focus-photo')) {
  pointer(doc, target, 'pointerdown', 200, 200);
  pointer(doc, target, 'pointermove', 200 - direction * 100, 205);
  pointer(doc, target, 'pointerup', 200 - direction * 100, 205);
}
const summary = [];
async function test(label, run) {
  try { await run(); summary.push('PASS ' + label); }
  catch (error) { summary.push('FAIL ' + label + ': ' + error.message); }
  finally { document.querySelector('#fixtures').replaceChildren(); results.textContent = summary.join('\n'); }
}
document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true; summary.length = 0;
  await test('empty gallery', async () => {
    const frame = await load('0');
    assert(!frame.contentDocument.querySelector('#emptyState').hidden, 'Empty state missing');
  });
  await test('single photo fills a wide wall', async () => {
    const frame = await load('1'); const doc = frame.contentDocument;
    const row = visibleBricks(doc).filter(el => el.dataset.row === '0');
    assert(row.length >= 2, 'No periodic copies');
    assert(Math.max(...row.map(el => el.getBoundingClientRect().right)) >= 1280, 'Blank right edge');
  });
  await test('21/200/1000 photos keep a bounded DOM', async () => {
    const counts = [];
    for (const count of [21, 200, 1000]) {
      const frame = await load(String(count)); const doc = frame.contentDocument;
      const nodes = doc.querySelectorAll('.brick').length;
      counts.push(count + ':' + nodes); assert(nodes < 180, 'Too many nodes: ' + nodes);
      frame.remove();
    }
    summary.push('MEASURE photo count : mounted bricks = ' + counts.join(', '));
  });
  await test('baseline wall positions and dimensions match', async () => {
    const current = await load('reference');
    const expected = (await (await fetch('wall-baseline.json')).json()).rects;
    const actual = visibleBricks(current.contentDocument);
    for (const a of expected) {
      const b = actual.find(b => +b.dataset.row === a[0] && +b.dataset.orderPos === a[1] && +b.dataset.cycle === a[2]);
      assert(b, 'Missing original visible brick');
      const br = b.getBoundingClientRect();
      ['left','top','width','height'].forEach((field,i) => assert(Math.abs(a[i+3] - br[field]) < 0.1, field + ' changed'));
    }
  });
  await test('dealt rows keep one viewport duplicate-free', async () => {
    const report = [];
    for (const count of [200, 1000]) {
      const frame = await load(String(count)); const doc = frame.contentDocument;
      await until(() => visibleBricks(doc).length > 0, 'wall ' + count);
      await pause(120);
      const visible = visibleBricks(doc);
      const unique = new Set(visible.map(el => el.dataset.i));
      report.push(count + ':' + visible.length + '/' + unique.size);
      assert(unique.size === visible.length,
        'Duplicate catalogue entries in one viewport: ' + visible.length + ' slots, ' + unique.size + ' unique');
      frame.remove();
    }
    summary.push('MEASURE dealt viewport slots/unique = ' + report.join(', '));
  });
  await test('open, focus trap, switch, close and cleanup', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    await until(() => photo(doc)?.querySelector('img').naturalWidth, 'first thumbnail');
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'open');
    assert(doc.activeElement.id === 'lbClose', 'Focus did not enter dialog');
    key(doc, 'Tab', true); assert(doc.querySelector('#lightbox').contains(doc.activeElement), 'Tab escaped');
    const title = doc.querySelector('#lbTitle').textContent;
    key(doc, 'ArrowRight'); await until(() => mode(doc) === 'switching', 'switch start');
    await until(() => mode(doc) === 'focused', 'switch finish');
    assert(doc.querySelector('#lbTitle').textContent !== title, 'Next photo not displayed');
    key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'close');
    assert(doc.querySelectorAll('.focus-photo,.is-focus-source').length === 0, 'Stale overlay or hidden source');
    assert(!doc.querySelector('#stage').inert, 'Wall remained inert');
    assert(doc.querySelector('#stage').contains(doc.activeElement), 'Focus did not return');
  });
  await test('cancel opening animation and cancel switching animation', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    await until(() => photo(doc)?.querySelector('img').naturalWidth, 'thumbnail');
    photo(doc).click(); await pause(120); key(doc, 'Escape');
    await until(() => mode(doc) === 'wall', 'cancel open');
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'open again');
    key(doc, 'ArrowRight'); await until(() => mode(doc) === 'switching', 'switching');
    await pause(120); key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'cancel switch');
    assert(doc.querySelectorAll('.focus-photo,.is-focus-source').length === 0, 'Cancellation leaked nodes');
  });
  await test('slow loading is immediately cancellable', async () => {
    const frame = await load('slow'); const doc = frame.contentDocument;
    photo(doc).click(); await until(() => mode(doc) === 'opening', 'loading');
    assert(!doc.querySelector('#lightbox').hidden, 'No close control while loading');
    doc.querySelector('#lbClose').click(); await until(() => mode(doc) === 'wall', 'cancel loading', 500);
    await pause(3300); assert(mode(doc) === 'wall', 'Late image reopened a cancelled scene');
  });
  await test('broken image recovers to usable wall', async () => {
    const frame = await load('broken'); const doc = frame.contentDocument;
    photo(doc).click(); await until(() => mode(doc) === 'wall', 'failure recovery');
    assert(!doc.querySelector('#stage').inert, 'Broken image trapped the user');
  });
  await test('keyboard opens a photo and horizontal wheel pans', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    doc.querySelector('#stage').focus(); key(doc, 'ArrowRight');
    assert(doc.activeElement.classList.contains('brick'), 'No keyboard photo target');
    key(doc, 'Enter'); await until(() => mode(doc) === 'focused', 'keyboard open');
    key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'keyboard close');
    const before = doc.querySelector('#wall').style.transform;
    doc.querySelector('#stage').dispatchEvent(new frame.contentWindow.WheelEvent('wheel', { deltaX: 100, deltaY: 0, bubbles: true, cancelable: true }));
    await pause(120); assert(doc.querySelector('#wall').style.transform !== before, 'Horizontal wheel ignored');
  });
  await test('deep link, refresh and browser back', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'open');
    const hash = frame.contentWindow.location.hash;
    assert(hash.includes('photo='), 'No permalink');
    frame.contentWindow.history.back(); await until(() => mode(doc) === 'wall', 'history close');
    frame.contentWindow.history.forward(); await until(() => mode(doc) === 'focused', 'history reopen');
    frame.contentWindow.location.reload();
    await new Promise(resolve => frame.onload = resolve);
    await until(() => mode(frame.contentDocument) === 'focused', 'refresh deep link');
    assert(frame.contentWindow.location.hash === hash, 'Link identity changed');
  });
  await test('rapid back/forward while closing keeps the latest route', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'open');
    frame.contentWindow.history.back(); await until(() => mode(doc) === 'closing', 'closing');
    frame.contentWindow.history.forward();
    await until(() => mode(doc) === 'focused', 'latest route');
    assert(frame.contentWindow.location.hash.includes('photo='), 'Latest link lost');
  });
  await test('mobile long metadata, collections and resize during animation', async () => {
    const frame = await load('long'); frame.style.width = '390px'; frame.style.height = '844px';
    const doc = frame.contentDocument; await pause(180);
    assert(!doc.querySelector('#collections').hidden, 'Collection control missing');
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'mobile open');
    assert(!doc.querySelector('#lbPermalink').hidden, 'Optional sharing link missing');
    assert(doc.documentElement.scrollWidth <= 390, 'Long metadata causes horizontal overflow');
    const title = doc.querySelector('#lbTitle').getBoundingClientRect();
    assert(title.width <= 390, 'Title overflow');
    const floating = doc.querySelector('.focus-photo').getBoundingClientRect();
    assert(floating.left >= 0 && floating.right <= 390.1, 'Single photo does not fit phone viewport');
    key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'mobile close');
    photo(doc).click(); await pause(100); frame.style.width = '720px';
    await until(() => mode(doc) === 'wall', 'resize cancellation');
    assert(doc.querySelectorAll('.focus-photo,.is-focus-source').length === 0, 'Resize leaked scene');
  });
  await test('mobile swipes, vertical scroll, pinch, controls and backdrop tap', async () => {
    const frame = await load('21'); frame.style.width = '390px'; frame.style.height = '844px';
    const doc = frame.contentDocument; await pause(180);
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'swipe open');
    const original = frame.contentWindow.location.hash;
    swipePhoto(doc, 1); await until(() => mode(doc) === 'switching', 'left swipe');
    await until(() => mode(doc) === 'focused', 'left swipe finish');
    assert(frame.contentWindow.location.hash !== original, 'Swipe did not advance');
    swipePhoto(doc, -1); await until(() => mode(doc) === 'switching', 'right swipe');
    await until(() => mode(doc) === 'focused', 'right swipe finish');
    assert(frame.contentWindow.location.hash === original, 'Right swipe did not return');
    const target = doc.querySelector('.focus-photo'), box = doc.querySelector('#lightbox');
    pointer(doc, target, 'pointerdown', 200, 200);
    pointer(doc, target, 'pointermove', 203, 250);
    pointer(doc, target, 'pointerup', 100, 280);
    pointer(doc, target, 'pointerdown', 200, 200);
    pointer(doc, target, 'pointerdown', 220, 200, 2);
    pointer(doc, target, 'pointerup', 100, 200);
    pointer(doc, target, 'pointerup', 300, 200, 2);
    pointer(doc, target, 'pointerdown', 200, 200);
    pointer(doc, target, 'pointercancel', 200, 200);
    pointer(doc, target, 'pointerup', 100, 200);
    swipePhoto(doc, 1, doc.querySelector('#lbNext'));
    await pause(350);
    assert(mode(doc) === 'focused' && frame.contentWindow.location.hash === original, 'Rejected gesture navigated');
    assert(frame.contentWindow.getComputedStyle(box).touchAction.includes('pinch-zoom'), 'Pinch disabled');
    swipePhoto(doc, 1, box); await until(() => mode(doc) === 'switching', 'backdrop swipe');
    await until(() => mode(doc) === 'focused', 'backdrop swipe finish');
    pointer(doc, box, 'pointerdown', 5, 5); pointer(doc, box, 'pointerup', 6, 5);
    await until(() => mode(doc) === 'wall', 'backdrop tap closes');
  });
  await test('pooled nodes preserve image ownership during rapid wall travel', async () => {
    const frame = await load('distinct'); const doc = frame.contentDocument;
    const initial = new Map([...doc.querySelectorAll('.brick')].map(el => [el, el.dataset.i]));
    const stage = doc.querySelector('#stage'); let reused = false;
    for (let i = 0; i < 20; i++) {
      pointer(doc, stage, 'pointerdown', 1100, 350);
      pointer(doc, stage, 'pointermove', 100, 350);
      pointer(doc, stage, 'pointercancel', 100, 350);
      await pause(40);
      for (const brick of doc.querySelectorAll('.brick')) if (initial.has(brick) && brick.dataset.i !== initial.get(brick)) reused = true;
      assert(doc.querySelectorAll('.brick').length < 180, 'Travel leaked mounted nodes');
    }
    await until(() => visibleBricks(doc).every(el => el.querySelector('img').naturalWidth), 'travel thumbnails', 20000);
    for (const brick of visibleBricks(doc)) {
      const expected = frame.contentWindow.GALLERY_DATA.items[+brick.dataset.i].thumb;
      assert(new URL(brick.querySelector('img').src).pathname === new URL(expected, location.origin).pathname, 'Old request overwrote recycled image');
    }
    assert(reused, 'Node pool was not exercised');
  });
  await test('camera animation frame sample', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    await until(() => photo(doc)?.querySelector('img').naturalWidth, 'thumbnail');
    const intervals = []; let last = 0; let finished = false;
    let semanticWrites = 0;
    const mutations = new frame.contentWindow.MutationObserver(records => { semanticWrites += records.length; });
    mutations.observe(doc.querySelector('#wall'), { subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'tabindex'] });
    function sample(now) { if (last) intervals.push(now-last); last=now; if (!finished) frame.contentWindow.requestAnimationFrame(sample); }
    frame.contentWindow.requestAnimationFrame(sample);
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'sample open');
    key(doc,'ArrowRight'); await until(() => mode(doc) === 'switching', 'sample switch');
    await until(() => mode(doc) === 'focused', 'sample switched');
    key(doc,'Escape'); await until(() => mode(doc) === 'wall', 'sample close');
    finished = true;
    mutations.disconnect();
    assert(semanticWrites < 1000, 'Semantic attributes are being rewritten each frame: ' + semanticWrites);
    intervals.sort((a,b)=>a-b);
    summary.push('MEASURE local frame intervals: samples=' + intervals.length + ', p50=' + intervals[Math.floor(intervals.length*.5)].toFixed(1) + 'ms, p95=' + intervals[Math.floor(intervals.length*.95)].toFixed(1) + 'ms, >25ms=' + intervals.filter(v=>v>25).length);
    summary.push('MEASURE semantic attribute writes during open/switch/close: ' + semanticWrites);
  });
  if (new URLSearchParams(location.search).has('extended')) {
    await test('distinct images under HTTP throttling and sustained navigation', async () => {
      const frame = await load('distinct'); const doc = frame.contentDocument;
      const run = new URL(frame.src).searchParams.get('run');
      const stats = async () => (await fetch('/__stats__?run=' + run)).json();
      photo(doc).click(); await until(() => mode(doc) === 'focused', 'cold weak-network open');
      let peakNodes = 0, peakOverlays = 0;
      const start = performance.now();
      for (let i = 0; i < 60; i++) {
        swipePhoto(doc, i % 10 < 7 ? 1 : -1);
        await until(() => mode(doc) === 'switching', 'sustained switch');
        await until(() => mode(doc) === 'focused', 'sustained settle');
        peakNodes = Math.max(peakNodes, doc.querySelectorAll('.brick').length);
        peakOverlays = Math.max(peakOverlays, doc.querySelectorAll('.focus-photo').length);
        assert(peakNodes < 240 && peakOverlays === 1, 'Sustained navigation leaked nodes');
        if (i % 10 === 0) results.textContent = summary.join('\n') + '\nRUNNING sustained navigation ' + (i + 1) + '/60';
      }
      const initial = frame.contentWindow.location.hash;
      await until(() => {
        const src = doc.querySelector('.focus-photo img').src;
        return src.includes('-detail.jpg') || src.startsWith('blob:');
      }, 'detail upgrade');
      key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'soak close');
      await pause(1200);
      const before = await stats();
      frame.contentWindow.location.hash = initial;
      await until(() => mode(doc) === 'focused', 'warm reopen'); await pause(1200);
      const after = await stats();
      assert(after.requests === before.requests, 'Warm reopen fetched retained assets again');
      key(doc, 'Escape'); await until(() => mode(doc) === 'wall', 'final close');
      assert(!doc.querySelector('.focus-photo,.is-focus-source'), 'Soak cleanup leaked nodes');
      summary.push('MEASURE distinct/HTTP soak: ' + ((performance.now() - start) / 1000).toFixed(1) + 's, requests=' + after.requests + ', bytes=' + after.bytes + ', peak settled bricks=' + peakNodes + ', overlays=' + peakOverlays + ', warm requests=' + (after.requests - before.requests));
    });
  }
  results.textContent = summary.join('\n') + '\nDONE';
  document.querySelector('#run').disabled = false;
};
