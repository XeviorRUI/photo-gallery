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
  await test('camera animation frame sample', async () => {
    const frame = await load('21'); const doc = frame.contentDocument;
    await until(() => photo(doc)?.querySelector('img').naturalWidth, 'thumbnail');
    const intervals = []; let last = 0; let finished = false;
    function sample(now) { if (last) intervals.push(now-last); last=now; if (!finished) frame.contentWindow.requestAnimationFrame(sample); }
    frame.contentWindow.requestAnimationFrame(sample);
    photo(doc).click(); await until(() => mode(doc) === 'focused', 'sample open');
    key(doc,'ArrowRight'); await until(() => mode(doc) === 'switching', 'sample switch');
    await until(() => mode(doc) === 'focused', 'sample switched');
    key(doc,'Escape'); await until(() => mode(doc) === 'wall', 'sample close');
    finished = true;
    intervals.sort((a,b)=>a-b);
    summary.push('MEASURE local frame intervals: samples=' + intervals.length + ', p50=' + intervals[Math.floor(intervals.length*.5)].toFixed(1) + 'ms, p95=' + intervals[Math.floor(intervals.length*.95)].toFixed(1) + 'ms, >25ms=' + intervals.filter(v=>v>25).length);
  });
  results.textContent = summary.join('\n') + '\nDONE';
  document.querySelector('#run').disabled = false;
};
