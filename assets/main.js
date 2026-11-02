/* ============================================================
   Photography portfolio interaction logic
   One wall, one camera, temporary floating photographs.
   ============================================================ */
(function () {
  'use strict';

  const GAP = 12;
  const PAD_X = 18;
  const PAD_BOTTOM = 26;
  const MIN_ROW_H = 110;
  const CLICK_MAX_MOVE = 8;
  const PREFETCH = 0.42;
  const MIDDLE_CYCLE = 1;
  const CAMERA_MOTION_MS = 820;
  const CLOSE_BACKDROP_MS = 420;
  const SWITCH_MOTION_MS = 680;
  const NAVIGATION_BURST_MS = 200;
  const DIRECT_SWITCH_MAX_MS = 980;
  const LIGHTBOX_WHEEL_STEP = 72;
  const LIGHTBOX_WHEEL_GAP_MS = 110;
  const MOTION_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const FLOAT_SCALE = 1.045;
  const WHEEL_SPEED_LIMIT = 2.6;
  const WHEEL_INPUT_SCALE = 0.007;
  const rawConfig = window.GALLERY_CONFIG || {};
  const siteConfig = {
    title: typeof rawConfig.title === 'string' && rawConfig.title.trim()
      ? rawConfig.title.trim()
      : 'MY GALLERY',
    subtitle: typeof rawConfig.subtitle === 'string'
      ? rawConfig.subtitle.trim()
      : 'Photography portfolio · drag to explore, click to open',
    showSubtitle: rawConfig.showSubtitle !== false,
    theme: rawConfig.theme === 'light' ? 'light' : 'dark',
  };
  const lightTheme = siteConfig.theme === 'light';
  const BACKDROP_FOCUS_FILTER = 'blur(3px)';
  const SHADE_FOCUS = lightTheme ? 'rgba(255, 255, 255, 0.48)' : 'rgba(5, 7, 6, 0.27)';
  const SHADOW_FLOAT = lightTheme
    ? '0 17px 28px -15px rgba(25, 30, 28, 0.46)'
    : '0 18px 30px -15px rgba(0, 0, 0, 0.88)';
  const PHOTO_CLEAR_FILTER = 'blur(0px) brightness(1) contrast(1) saturate(1)';
  const PHOTO_BACKGROUND_FILTER = lightTheme
    ? 'blur(3px) brightness(1.2) contrast(0.82) saturate(0.72)'
    : 'blur(3px) brightness(0.54) contrast(1) saturate(0.82)';
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionPreference.matches;
  motionPreference.addEventListener('change', event => { reducedMotion = event.matches; });

  const $ = (selector, root) => (root || document).querySelector(selector);

  const stage = $('#stage');
  const wall = $('#wall');
  const emptyState = $('#emptyState');
  const metaEl = $('#wallMeta');
  const hint = $('#hint');
  const siteTitle = $('#siteTitle');
  const siteSubtitle = $('#siteSubtitle');
  const lightbox = $('#lightbox');
  const focusBackdrop = $('#focusBackdrop');
  const focusLayer = $('#focusLayer');
  const lbTitle = $('#lbTitle');
  const lbCat = $('#lbCat');
  const lbChips = $('#lbChips');

  const data = (typeof window.GALLERY_DATA !== 'undefined' && window.GALLERY_DATA) || null;
  const allItems = GalleryCatalog.normalize(data);
  const collection = new URLSearchParams(location.search).get('collection');
  const items = collection ? allItems.filter(item => item.category === collection
    || (item.tags || []).includes(collection)) : allItems;
  const storageKey = 'gallery:' + location.pathname;
  let storage = null;
  try { storage = window.sessionStorage; } catch (_) {}
  const savedView = GalleryCatalog.read(storage, storageKey) || {};
  const requestedSeed = Number(new URLSearchParams(location.search).get('seed'));
  const seed = requestedSeed || savedView.seed || (Math.random() * 4294967296 >>> 0);
  const itemById = new Map(items.map((item, index) => [item.id, index]));
  const bricks = [];
  const brickByElement = new WeakMap();
  const hiddenBricks = new Set();
  const imageLoader = GalleryImages.create();
  let mounted = new Map();
  const brickPool = [];
  const wanted = new Map(), semantic = new Map(), keepSources = new Set();
  const foregroundSources = new Map(), warmSources = new Set();
  const swipe = GallerySwipe.create();
  let swipeBackdrop = false, navigationDirection = 1;
  const scene = GalleryScene.create(mode => { stage.dataset.mode = mode; });
  let geometry = null;
  let cameraFlight = null;
  let cameraFrame = null;
  let historyEntry = false;
  let historyUpdating = false;
  let routePending = false;
  let routing = false;
  let closingPromise = null;
  let returnFocus = null;
  let keyboardIndex = 0;
  let saveTimer = null;

  let displayOrder = [];
  let orderPosByItem = [];
  let vw = 0;
  let vh = 0;
  let padTop = 0;
  let rowCount = 0;
  let rowH = 0;
  let rowStride = 1;
  let cycleW = 0;
  let pan = 0;
  let laidOut = false;
  let relayoutQueued = false;
  let layoutDeferred = false;
  let visibilityCheckId = null;
  let inertiaId = null;
  let wheelInertiaId = null;
  let wheelVelocity = 0;
  let wheelTargetVelocity = 0;
  let wheelLastFrame = 0;
  let wheelLastInput = 0;
  let interaction = null;
  let dragMoved = false;
  let suppressClickUntil = 0;

  let activeIndex = -1;
  let activeOrderPos = -1;
  let activePlacement = null;
  let activeCamera = null;
  let activeOverlay = null;
  let activeOverlayRect = null;
  let homeAnchorRatio = 0.5;
  let activeSwitchSteps = 0;
  let pendingNavigationSteps = 0;
  let navigationBurstTimer = null;
  let lightboxWheelDelta = 0;
  let lightboxWheelDirection = 0;
  let lightboxWheelLastInput = 0;
  let closePreparation = null;

  applySiteConfig();

  const collectionSelect = $('#collections');
  if (rawConfig.showCollections) {
    const labels = [...new Set(allItems.flatMap(item => [item.category, ...(item.tags || [])]).filter(Boolean))].sort();
    [['', 'All photographs'], ...labels.map(label => [label, label])].forEach(([value, label]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = label;
      collectionSelect.appendChild(option);
    });
    collectionSelect.value = collection || '';
    collectionSelect.hidden = false;
    collectionSelect.addEventListener('change', () => {
      const url = new URL(location.href); url.hash = '';
      if (collectionSelect.value) url.searchParams.set('collection', collectionSelect.value);
      else url.searchParams.delete('collection');
      location.href = url.href;
    });
  }

  if (!items.length) {
    metaEl.textContent = '0 photographs';
    emptyState.hidden = false;
    return;
  }

  displayOrder = GalleryCatalog.shuffledIndices(items, seed, rawConfig.order === 'curated');
  orderPosByItem = new Array(items.length);
  displayOrder.forEach(function (itemIndex, orderPos) {
    orderPosByItem[itemIndex] = orderPos;
  });
  metaEl.textContent = items.length + ' photographs';

  function applySiteConfig() {
    document.documentElement.dataset.theme = siteConfig.theme;
    siteTitle.textContent = siteConfig.title;
    siteSubtitle.textContent = siteConfig.subtitle;
    siteSubtitle.hidden = !siteConfig.showSubtitle || !siteConfig.subtitle;
    document.title = siteConfig.title + ' · Photography Portfolio';
  }

  /* ---------- Wall layout ---------- */
  function updateViewport() {
    const rect = stage.getBoundingClientRect();
    vw = rect.width;
    vh = rect.height;
    return vw > 0 && vh > 0;
  }

  // Deal the catalogue across both axes. Column `c` of row `r` holds
  // displayOrder[(r + c * stride) % count], so the photos visible in one
  // viewport are consecutive along the shuffled catalogue instead of the same
  // sequence shifted per row. The stride is the smallest one that keeps every
  // row a full permutation (coprime with the count) and, when the catalogue is
  // large enough, keeps the row windows from overlapping in that viewport.
  function chooseRowStride(widths) {
    const count = widths.length;
    if (count < 2) return 1;
    const totalRows = rowCount + 2;
    const average = widths.reduce((sum, width) => sum + width, 0) / count;
    const visibleColumns = Math.max(1, Math.ceil(vw / Math.max(1, average + GAP)) + 3);
    const limit = visibleColumns > 1
      ? Math.floor((count - totalRows) / (visibleColumns - 1))
      : count;
    for (let stride = totalRows; stride <= limit; stride++) {
      if (GalleryLayout.gcd(stride, count) === 1) return stride;
    }
    // The catalogue is too small for a duplicate-free viewport; still spread
    // the rows instead of stacking shifted copies of one sequence.
    for (let stride = totalRows; stride <= totalRows + count; stride++) {
      if (GalleryLayout.gcd(stride, count) === 1) return stride;
    }
    return 1;
  }

  function layout() {
    if (scene.mode !== 'wall' || !updateViewport()) return;

    emptyState.hidden = true;
    clearHiddenBricks();
    const anchor = laidOut ? captureAnchor() : savedView.anchor;

    padTop = Math.min(104, Math.max(64, Math.round(vh * 0.115)));
    const edgePeek = Math.min(54, Math.max(30, Math.round(vh * 0.055)));
    const availableHeight = Math.max(
      MIN_ROW_H,
      vh - padTop - PAD_BOTTOM - edgePeek - GAP
    );
    const desiredRowHeight = Math.min(300, Math.max(140, availableHeight / 4.2));
    let rows;

    if (items.length <= 2) rows = 1;
    else if (items.length <= 6) rows = Math.min(items.length, Math.max(1, Math.ceil(items.length / 2)));
    else rows = Math.min(items.length, Math.max(2, Math.round(availableHeight / desiredRowHeight)));

    const rowCap = Math.max(1, Math.floor((availableHeight + GAP) / (MIN_ROW_H + GAP)));
    rowCount = Math.max(1, Math.min(rows, rowCap));
    rowH = (availableHeight - (rowCount - 1) * GAP) / rowCount;

    const widths = displayOrder.map(function (itemIndex) {
      return Math.max(40, itemAspect(items[itemIndex]) * rowH);
    });
    rowStride = chooseRowStride(widths);
    const rowDefinitions = [{
      row: -1,
      y: padTop - GAP - rowH,
      offset: -1,
      stride: rowStride,
      decorative: true,
    }];
    for (let row = 0; row < rowCount; row++) {
      rowDefinitions.push({
        row: row,
        y: padTop + row * (rowH + GAP),
        offset: row,
        stride: rowStride,
        decorative: false,
      });
    }
    rowDefinitions.push({
      row: rowCount,
      y: padTop + rowCount * (rowH + GAP),
      offset: rowCount,
      stride: rowStride,
      decorative: true,
    });

    mounted.forEach(recycleBrick);
    mounted.clear();
    bricks.length = 0;
    geometry = GalleryLayout.create(widths, rowDefinitions, rowH, GAP, PAD_X);
    cycleW = geometry.cycleWidth;
    // Only the viewport is a paint surface; children retain logical wall coordinates.
    wall.style.width = vw + 'px';
    wall.style.height = vh + 'px';
    pan = -cycleW;
    if (anchor && itemById.has(anchor.id)) {
      const brick = geometry.copy(0, orderPosByItem[itemById.get(anchor.id)], 1);
      pan = vw * (anchor.screen ?? 0.5) - brick.x - brick.w * (anchor.fraction ?? 0.5);
    }
    laidOut = true;
    applyPan();
    ensureVisibleForCameras([normalCamera()]);
  }

  function captureAnchor() {
    if (!geometry) return null;
    const worldX = vw / 2 - pan;
    const candidates = geometry.query(worldX - rowH * 10, worldX + rowH * 10)
      .filter(brick => brick.row === 0);
    const brick = candidates.reduce((best, b) => !best || Math.abs(b.x + b.w / 2 - worldX)
      < Math.abs(best.x + best.w / 2 - worldX) ? b : best, null);
    return brick ? { id: items[displayOrder[brick.orderPos]].id,
      fraction: (worldX - brick.x) / brick.w, screen: 0.5 } : null;
  }

  function rememberView() {
    GalleryCatalog.write(storage, storageKey, { seed, anchor: captureAnchor() });
  }

  function itemAspect(item) {
    if (item && item.width > 0 && item.height > 0) return item.width / item.height;
    return 1;
  }

  function normalizedPan(value) {
    if (!cycleW) return value;
    return -cycleW - GalleryLayout.mod(-value - cycleW, cycleW);
  }

  // Move the logical wall by whole cycles while keeping every mounted node and
  // its decoded image. Periodic content makes this visually identical to a
  // rebuild, without the placeholder flash that a remount causes.
  function shiftWallCycles(cycles) {
    if (!cycles || !cycleW || !mounted.size) return;
    const stride = cycles * cycleW;
    const ordinalStep = cycles * items.length;
    const rekeyed = new Map();
    mounted.forEach(function (brick) {
      brick.ordinal += ordinalStep;
      brick.cycle = Math.floor(brick.ordinal / items.length);
      brick.x += stride;
      brick.key = brick.row + ':' + brick.ordinal;
      brick.el.dataset.cycle = brick.cycle;
      brick.el.style.left = brick.x + 'px';
      rekeyed.set(brick.key, brick);
    });
    mounted = rekeyed;
    if (activePlacement) activePlacement = { brick: activePlacement.brick, x: activePlacement.x + stride };
  }

  function applyPan() {
    pan = normalizedPan(pan);
    wall.style.transform = cameraTransform(normalCamera());
  }

  function setPan(nextPan) {
    const target = normalizedPan(nextPan);
    if (cycleW) {
      const cycles = Math.round((nextPan - target) / cycleW);
      if (cycles) shiftWallCycles(cycles);
    }
    pan = target;
    applyPan();
    scheduleVisibilityCheck();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(rememberView, 180);
  }

  function normalCamera() {
    return { tx: pan, ty: 0, scale: 1 };
  }

  /* ---------- Infinite dragging ---------- */
  function pointFromEvent(event, touch) {
    const point = touch ? (event.touches[0] || event.changedTouches[0]) : event;
    return point ? { x: point.clientX, y: point.clientY } : null;
  }

  function beginInteraction(event, touch) {
    if (scene.mode !== 'wall') return;
    if (!touch && event.button !== 0) return;
    const point = pointFromEvent(event, touch);
    if (!point) return;
    stopInertia();
    stopWheelInertia();
    interaction = {
      startX: point.x,
      startPan: pan,
      lastX: point.x,
      lastTime: performance.now(),
      velocity: 0,
      brick: brickAtPoint(event.target, point.x, point.y),
    };
    dragMoved = false;
    if (touch && event.cancelable) event.preventDefault();
  }

  function moveInteraction(event, touch) {
    if (!interaction) return;
    const point = pointFromEvent(event, touch);
    if (!point) return;
    const deltaX = point.x - interaction.startX;
    const now = performance.now();
    interaction.velocity = (point.x - interaction.lastX)
      / Math.max(8, now - interaction.lastTime);
    interaction.lastX = point.x;
    interaction.lastTime = now;

    if (Math.abs(deltaX) > CLICK_MAX_MOVE && !dragMoved) {
      dragMoved = true;
      stage.classList.add('panning');
    }
    if (dragMoved) {
      if (touch && event.cancelable) event.preventDefault();
      setPan(interaction.startPan + deltaX);
    }
  }

  function endInteraction(event, touch) {
    if (!interaction) return;
    const completed = interaction;
    interaction = null;
    stage.classList.remove('panning');
    suppressClickUntil = performance.now() + (touch ? 500 : 220);

    if (!dragMoved) {
      const element = completed.brick
        || (event.target && event.target.closest ? event.target.closest('.brick') : null);
      dragMoved = false;
      if (element) openPhoto(parseInt(element.dataset.i, 10), element);
      return;
    }

    dragMoved = false;
    startInertia(completed.velocity);
  }

  function startInertia(velocity) {
    stopInertia();
    // Preserve the original short glide while using px/ms throughout.
    let currentVelocity = reducedMotion ? 0 : velocity / 16.7;
    let lastTime = performance.now();
    const step = function (now) {
      const deltaTime = Math.min(50, now - lastTime);
      lastTime = now;
      setPan(pan + currentVelocity * deltaTime);
      currentVelocity *= Math.pow(0.95, deltaTime / 16.7);
      if (Math.abs(currentVelocity) > 0.08 / 16.7) inertiaId = requestAnimationFrame(step);
      else inertiaId = null;
    };
    inertiaId = requestAnimationFrame(step);
  }

  function stopInertia() {
    if (!inertiaId) return;
    cancelAnimationFrame(inertiaId);
    inertiaId = null;
  }

  function wheelDeltaInPixels(event) {
    let delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= vh || window.innerHeight;
    return Math.max(-160, Math.min(160, delta));
  }

  function beginWheelMotion(event) {
    if (scene.mode !== 'wall' || event.ctrlKey) return;
    const delta = wheelDeltaInPixels(event);
    if (!delta) return;
    if (event.cancelable) event.preventDefault();

    stopInertia();
    if (reducedMotion) {
      setPan(pan - delta * 0.8);
      return;
    }

    const impulse = -delta * WHEEL_INPUT_SCALE;
    if (wheelTargetVelocity * impulse < 0) wheelTargetVelocity *= 0.28;
    wheelTargetVelocity = Math.max(
      -WHEEL_SPEED_LIMIT,
      Math.min(WHEEL_SPEED_LIMIT, wheelTargetVelocity + impulse)
    );
    wheelLastInput = performance.now();

    if (!wheelInertiaId) {
      wheelLastFrame = wheelLastInput;
      wheelInertiaId = requestAnimationFrame(stepWheelMotion);
    }
  }

  function beginLightboxWheelNavigation(event) {
    const info = event.target.closest && event.target.closest('#lbInfo');
    if (info && info.scrollHeight > info.clientHeight) return;
    if ((scene.mode !== 'focused' && scene.mode !== 'switching') || event.ctrlKey) return;
    const delta = wheelDeltaInPixels(event);
    if (!delta) return;
    if (event.cancelable) event.preventDefault();

    const now = performance.now();
    const direction = delta > 0 ? 1 : -1;
    if (now - lightboxWheelLastInput > LIGHTBOX_WHEEL_GAP_MS
      || direction !== lightboxWheelDirection) {
      lightboxWheelDelta = 0;
    }
    lightboxWheelLastInput = now;
    lightboxWheelDirection = direction;
    lightboxWheelDelta += Math.abs(delta);

    if (lightboxWheelDelta < LIGHTBOX_WHEEL_STEP) return;
    lightboxWheelDelta %= LIGHTBOX_WHEEL_STEP;
    requestNavigation(direction);
  }

  function stepWheelMotion(now) {
    if (scene.mode !== 'wall') {
      stopWheelInertia();
      return;
    }

    const deltaTime = Math.min(34, Math.max(1, now - wheelLastFrame));
    wheelLastFrame = now;
    const accelerationBlend = 1 - Math.exp(-deltaTime / 68);
    wheelVelocity += (wheelTargetVelocity - wheelVelocity) * accelerationBlend;

    if (now - wheelLastInput > 52) {
      wheelTargetVelocity *= Math.exp(-deltaTime / 145);
    }
    wheelVelocity *= Math.exp(-deltaTime / 560);
    setPan(pan + wheelVelocity * deltaTime);

    if (Math.abs(wheelVelocity) > 0.012 || Math.abs(wheelTargetVelocity) > 0.012) {
      wheelInertiaId = requestAnimationFrame(stepWheelMotion);
    } else {
      wheelInertiaId = null;
      wheelVelocity = 0;
      wheelTargetVelocity = 0;
    }
  }

  function stopWheelInertia() {
    if (wheelInertiaId) cancelAnimationFrame(wheelInertiaId);
    wheelInertiaId = null;
    wheelVelocity = 0;
    wheelTargetVelocity = 0;
  }

  function brickAtPoint(target, x, y) {
    const direct = target && target.closest ? target.closest('.brick') : null;
    if (direct) return direct;
    const hit = document.elementFromPoint(x, y);
    return hit && hit.closest ? hit.closest('.brick') : null;
  }

  stage.addEventListener('pointerdown', event => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    beginInteraction(event, false);
    if (interaction) {
      interaction.pointerId = event.pointerId;
      try { stage.setPointerCapture(event.pointerId); } catch (_) {}
    }
  });
  stage.addEventListener('pointermove', event => {
    if (interaction && event.pointerId === interaction.pointerId) moveInteraction(event, false);
  });
  stage.addEventListener('pointerup', event => {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    endInteraction(event, false);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  });
  function cancelPointer() {
    interaction = null; dragMoved = false;
    stage.classList.remove('panning');
  }
  stage.addEventListener('pointercancel', cancelPointer);
  stage.addEventListener('lostpointercapture', cancelPointer);
  stage.addEventListener('wheel', beginWheelMotion, { passive: false });
  stage.addEventListener('click', event => {
    if (scene.mode !== 'wall' || performance.now() < suppressClickUntil) return;
    const element = event.target.closest('.brick');
    if (element) openPhoto(Number(element.dataset.i), element);
  });

  /* ---------- Image loading ---------- */
  function wallSourceForItem(item, size) {
    return GalleryImages.source(item, (size || rowH * itemAspect(item)) * (window.devicePixelRatio || 1), false);
  }

  function mountBrick(spec) {
    if (mounted.has(spec.key)) return mounted.get(spec.key);
    const brick = { ...spec, itemIdx: displayOrder[spec.orderPos] };
    const recycled = brickPool.pop();
    const element = recycled ? recycled.el : document.createElement('div');
    const image = recycled ? recycled.img : document.createElement('img');
    brick.el = element; brick.img = image;
    element.className = 'brick ready' + (brick.decorative ? ' decorative' : '');
    Object.assign(element.dataset, { i: brick.itemIdx, orderPos: brick.orderPos, row: brick.row, cycle: brick.cycle });
    Object.assign(element.style, { width: brick.w + 'px', height: brick.h + 'px',
      left: brick.x + 'px', top: brick.y + 'px', background: tone(brick.itemIdx) });
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', items[brick.itemIdx].title || 'Untitled');
    element.tabIndex = -1;
    element.setAttribute('aria-hidden', 'true');
    image.alt = ''; image.draggable = false; image.decoding = 'async';
    element.appendChild(image); wall.appendChild(element);
    mounted.set(brick.key, brick); brickByElement.set(element, brick);
    const src = wallSourceForItem(items[brick.itemIdx], Math.max(brick.w, brick.h));
    brick.src = src;
    imageLoader.load(src, 1).catch(error => {
      if (error.name === 'AbortError' || brickByElement.get(element) !== brick) throw error;
      brick.src = items[brick.itemIdx].file;
      return imageLoader.load(brick.src, 1);
    }).then(loaded => {
      if (brickByElement.get(element) !== brick) return;
      image.src = loaded.currentSrc || loaded.src;
      image.classList.add('in');
    }).catch(error => {
      if (brickByElement.get(element) === brick && error.name !== 'AbortError') element.classList.add('image-unavailable');
    });
    return brick;
  }

  function recycleBrick(brick) {
    brickByElement.delete(brick.el);
    brick.el.remove();
    brick.img.removeAttribute('src');
    brick.img.className = '';
    // Bound detached nodes as well as mounted nodes. Async callbacks check ownership.
    if (brickPool.length < 32) brickPool.push(brick);
  }

  function ensureVisibleForCameras(cameras) {
    if (!geometry || !cameras.length) return;
    wanted.clear();
    cameras.forEach(camera => {
      const scale = Math.max(0.01, camera.scale);
      const margin = vw * PREFETCH / scale;
      geometry.visit(-camera.tx / scale - margin, (vw - camera.tx) / scale + margin,
        -camera.ty / scale - rowH, (vh - camera.ty) / scale + rowH, (row, ordinal) => {
          const key = row + ':' + ordinal;
          if (!wanted.has(key)) wanted.set(key, mounted.get(key) || geometry.at(row, ordinal));
        });
    });
    hiddenBricks.forEach(brick => wanted.set(brick.key, brick));
    if (activePlacement) wanted.set(activePlacement.brick.key, activePlacement.brick);
    if (interaction && interaction.brick) {
      const brick = brickByElement.get(interaction.brick);
      if (brick) wanted.set(brick.key, brick);
    }
    const focused = brickByElement.get(document.activeElement);
    if (focused) wanted.set(focused.key, focused);
    const returning = brickByElement.get(returnFocus);
    if (returning) wanted.set(returning.key, returning);
    mounted.forEach((brick, key) => {
      if (!wanted.has(key)) { recycleBrick(brick); mounted.delete(key); }
    });
    wanted.forEach(mountBrick);
    bricks.length = 0;
    mounted.forEach(brick => bricks.push(brick));
    semantic.clear();
    bricks.forEach(brick => {
      if (brick.decorative) return;
      const previous = semantic.get(brick.itemIdx);
      if (!previous || Math.abs(brick.x + pan + brick.w / 2 - vw / 2)
        < Math.abs(previous.x + pan + previous.w / 2 - vw / 2)) semantic.set(brick.itemIdx, brick);
    });
    const keyboardBrick = semantic.get(keyboardIndex) || semantic.values().next().value;
    bricks.forEach(brick => {
      const hidden = semantic.get(brick.itemIdx) !== brick;
      if (hidden !== brick.el.hasAttribute('aria-hidden')) {
        if (hidden) brick.el.setAttribute('aria-hidden', 'true');
        else brick.el.removeAttribute('aria-hidden');
      }
      const tabIndex = brick === keyboardBrick ? 0 : -1;
      if (brick.el.tabIndex !== tabIndex) brick.el.tabIndex = tabIndex;
    });
    pruneImages();
  }

  function pruneImages() {
    keepSources.clear();
    mounted.forEach(brick => keepSources.add(brick.src));
    foregroundSources.forEach((count, src) => keepSources.add(src));
    warmSources.forEach(src => keepSources.add(src));
    if (activeIndex >= 0) keepSources.add(detailSource(activeIndex));
    imageLoader.prune(keepSources);
  }

  function prepareWallForCameras(cameras) {
    ensureVisibleForCameras(cameras);
    // Background fetches never block an input or a camera transition.
    return Promise.resolve();
  }

  function scheduleVisibilityCheck() {
    if (visibilityCheckId) return;
    visibilityCheckId = requestAnimationFrame(() => {
      visibilityCheckId = null;
      if (scene.mode === 'wall') ensureVisibleForCameras([normalCamera()]);
    });
  }

  function detailSource(index) {
    const metrics = focusMetrics();
    const aspect = itemAspect(items[index]);
    const height = Math.min(metrics.maxHeight, metrics.maxWidth / aspect);
    return GalleryImages.source(items[index], Math.max(height, height * aspect) * (window.devicePixelRatio || 1), true);
  }

  function cancelledImageError() {
    return Object.assign(new Error('Scene cancelled'), { name: 'AbortError' });
  }

  function loadForeground(src, signal) {
    if (signal && signal.aborted) return Promise.reject(cancelledImageError());
    foregroundSources.set(src, (foregroundSources.get(src) || 0) + 1);
    let released = false;
    // Releases the loader's last consumer as soon as the scene is cancelled, so
    // the loader may drop the request instead of waiting for it to finish.
    const release = () => {
      if (released) return;
      released = true;
      const remaining = foregroundSources.get(src) - 1;
      if (remaining) foregroundSources.set(src, remaining);
      else foregroundSources.delete(src);
    };
    const onAbort = () => release();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    return imageLoader.load(src, 0).finally(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      release();
    });
  }

  function preloadPhoto(index, priority = 0, signal) {
    const src = detailSource(index);
    return priority === 0 ? loadForeground(src, signal) : imageLoader.load(src, priority);
  }

  function sceneStart(mode) { swipe.reset(); return scene.begin(mode); }

  function previewPhoto(index, sourceBrick) {
    if (sourceBrick && sourceBrick.img.complete && sourceBrick.img.naturalWidth) return Promise.resolve(sourceBrick.img);
    const signal = scene.signal;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new Error('Scene cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      loadForeground(wallSourceForItem(items[index]), signal)
        .catch(error => {
          if (signal.aborted || error.name === 'AbortError') throw error;
          return preloadPhoto(index, 0, signal);
        }).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  }

  function upgradeOverlay(overlay, index) {
    preloadPhoto(index, 0, scene.signal).then(image => {
      if (overlay.isConnected) overlay.querySelector('img').src = image.currentSrc || image.src;
    }).catch(error => {
      if (error && error.name === 'AbortError') return;
      if (overlay.isConnected) $('#lbStatus').textContent = 'Full resolution unavailable; showing preview.';
    });
  }

  /* ---------- Camera geometry ---------- */
  function cameraTransform(camera) {
    return 'translate3d(' + camera.tx + 'px,' + camera.ty + 'px,0) scale(' + camera.scale + ')';
  }

  function focusMetrics() {
    const compact = vw <= 720;
    const topInset = compact ? 24 : 44;
    const bottomInset = compact ? 104 : 138;
    const usableHeight = Math.max(180, vh - topInset - bottomInset);
    return {
      centerX: vw / 2,
      centerY: topInset + usableHeight / 2,
      maxWidth: Math.min(vw * (compact ? 0.88 : 0.9), 1520),
      maxHeight: usableHeight,
    };
  }

  function cameraForPlacement(placement) {
    const metrics = focusMetrics();
    const scaleByWidth = metrics.maxWidth / (placement.brick.w * FLOAT_SCALE);
    const scaleByHeight = metrics.maxHeight / (placement.brick.h * FLOAT_SCALE);
    const scale = Math.max(0.01, Math.min(7, Math.min(scaleByWidth, scaleByHeight)));
    const centerX = placement.x + placement.brick.w / 2;
    const centerY = placement.brick.y + placement.brick.h / 2;
    return {
      tx: metrics.centerX - scale * centerX,
      ty: metrics.centerY - scale * centerY,
      scale: scale,
    };
  }

  function wallCameraForPlacement(placement) {
    const homeX = homeAnchorRatio * vw;
    return {
      tx: homeX - (placement.x + placement.brick.w / 2),
      ty: 0,
      scale: 1,
    };
  }

  function rectForPlacement(placement, camera) {
    return {
      left: camera.tx + placement.x * camera.scale,
      top: camera.ty + placement.brick.y * camera.scale,
      width: placement.brick.w * camera.scale,
      height: placement.brick.h * camera.scale,
    };
  }

  function floatingRect(placement, camera) {
    const base = rectForPlacement(placement, camera);
    const width = base.width * FLOAT_SCALE;
    const height = base.height * FLOAT_SCALE;
    return {
      left: base.left - (width - base.width) / 2,
      top: base.top - (height - base.height) / 2,
      width: width,
      height: height,
    };
  }

  function findBrickByElement(element) {
    return brickByElement.get(element) || null;
  }

  function findBrickCopy(row, orderPos, cycle) {
    return mountBrick(geometry.copy(row, orderPos, cycle));
  }

  function adjacentPlacement(placement, direction) {
    return placementAfterSteps(placement, direction);
  }

  function rebaseActiveToMiddleCycle() {
    if (!activePlacement || !activeCamera || !cycleW) return;
    const cycles = MIDDLE_CYCLE - Math.floor(activePlacement.brick.ordinal / items.length);
    if (!cycles) return;
    shiftWallCycles(cycles);
    activeCamera = {
      tx: activeCamera.tx - activeCamera.scale * cycles * cycleW,
      ty: activeCamera.ty,
      scale: activeCamera.scale,
    };
    setWallState(activeCamera);
  }

  /* ---------- Shared animation primitives ---------- */
  function duration(value) {
    return reducedMotion ? 0 : value;
  }

  function animationOptions(milliseconds) {
    return {
      duration: duration(milliseconds),
      easing: MOTION_EASE,
      fill: 'both',
    };
  }

  function setWallState(camera) {
    wall.style.transform = cameraTransform(camera);
  }

  function animateWall(fromCamera, toCamera, milliseconds, pinnedCameras) {
    setWallState(fromCamera);
    const animation = wall.animate([
      { transform: cameraTransform(fromCamera) },
      { transform: cameraTransform(toCamera) },
    ], animationOptions(milliseconds));
    cameraFlight = { animation, fromCamera, toCamera };
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    // Pre-mounted regions stay mounted for the whole flight: recycling them at
    // the start of a zoom-out forces a second mount later, and each rebuild
    // paints the placeholder colour for a frame.
    const pinned = pinnedCameras || [fromCamera, toCamera];
    const frame = () => {
      if (!cameraFlight || cameraFlight.animation !== animation) return;
      ensureVisibleForCameras([currentCamera()].concat(pinned));
      if (animation.playState === 'running' || animation.pending) cameraFrame = requestAnimationFrame(frame);
    };
    cameraFrame = requestAnimationFrame(frame);
    return animation;
  }

  function setBackdrop(focused) {
    focusBackdrop.style.backgroundColor = SHADE_FOCUS;
    focusBackdrop.style.backdropFilter = focused ? BACKDROP_FOCUS_FILTER : 'none';
    focusBackdrop.style.webkitBackdropFilter = focused ? BACKDROP_FOCUS_FILTER : 'none';
    focusBackdrop.style.opacity = focused ? '1' : '0';
  }

  function animateBackdrop(fromFocused, toFocused, milliseconds) {
    focusBackdrop.style.backgroundColor = SHADE_FOCUS;
    focusBackdrop.style.backdropFilter = BACKDROP_FOCUS_FILTER;
    focusBackdrop.style.webkitBackdropFilter = BACKDROP_FOCUS_FILTER;
    focusBackdrop.style.opacity = fromFocused ? '1' : '0';
    return focusBackdrop.animate([
      { opacity: fromFocused ? 1 : 0 },
      { opacity: toFocused ? 1 : 0 },
    ], animationOptions(milliseconds));
  }

  function depthStyle(depth) {
    if (depth === 'float') return { shadowOpacity: 1, filter: PHOTO_CLEAR_FILTER };
    if (depth === 'background') return { shadowOpacity: 0, filter: PHOTO_BACKGROUND_FILTER };
    return { shadowOpacity: 0, filter: PHOTO_CLEAR_FILTER };
  }

  function setOverlayRect(overlay, rect) {
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.transform = 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0)';
  }

  function setOverlayDepth(overlay, depth) {
    const style = depthStyle(depth);
    overlay.style.filter = style.filter;
    if (overlay.focusShadow) overlay.focusShadow.style.opacity = String(style.shadowOpacity);
  }

  function overlayTransform(rect, baseRect) {
    const scaleX = rect.width / Math.max(1, baseRect.width);
    const scaleY = rect.height / Math.max(1, baseRect.height);
    return 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0) scale('
      + scaleX + ',' + scaleY + ')';
  }

  function animateOverlay(overlay, fromRect, toRect, fromDepth, toDepth, milliseconds) {
    const fromStyle = depthStyle(fromDepth);
    const toStyle = depthStyle(toDepth);
    overlay.style.width = fromRect.width + 'px';
    overlay.style.height = fromRect.height + 'px';
    overlay.style.transformOrigin = '0 0';
    overlay.style.transform = overlayTransform(fromRect, fromRect);
    overlay.style.filter = fromStyle.filter;
    if (overlay.focusShadow) {
      overlay.focusShadow.style.opacity = String(fromStyle.shadowOpacity);
    }

    const fromFrame = { transform: overlayTransform(fromRect, fromRect) };
    const toFrame = { transform: overlayTransform(toRect, fromRect) };
    if (fromStyle.filter !== toStyle.filter) {
      fromFrame.filter = fromStyle.filter;
      toFrame.filter = toStyle.filter;
    }

    const animations = [overlay.animate([fromFrame, toFrame], animationOptions(milliseconds))];
    if (overlay.focusShadow && fromStyle.shadowOpacity !== toStyle.shadowOpacity) {
      animations.push(overlay.focusShadow.animate([
        { opacity: fromStyle.shadowOpacity },
        { opacity: toStyle.shadowOpacity },
      ], animationOptions(milliseconds)));
    }
    return animations;
  }

  function animateOverlayHandoff(overlay, milliseconds) {
    overlay.style.opacity = '1';
    return overlay.animate([
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: 0.52 },
      { opacity: 0, offset: 1 },
    ], animationOptions(milliseconds));
  }

  function animateOverlayReveal(overlay, milliseconds) {
    overlay.style.opacity = '0';
    return overlay.animate([
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.18 },
      { opacity: 1, offset: 1 },
    ], animationOptions(milliseconds));
  }

  function currentCamera() {
    if (!cameraFlight) return activeCamera || normalCamera();
    const { animation, fromCamera, toCamera } = cameraFlight;
    const p = animation.effect.getComputedTiming().progress ?? 0;
    return { tx: fromCamera.tx + (toCamera.tx - fromCamera.tx) * p,
      ty: fromCamera.ty + (toCamera.ty - fromCamera.ty) * p,
      scale: fromCamera.scale + (toCamera.scale - fromCamera.scale) * p };
  }

  async function playTogether(animations) {
    animations.forEach(animation => scene.animations.add(animation));
    const startTime = document.timeline.currentTime;
    if (startTime !== null) {
      animations.forEach(function (animation) {
        try { animation.startTime = startTime; } catch (_) {}
      });
    }
    await Promise.all(animations.map(function (animation) {
      return animation.finished.catch(function () {});
    }));
  }

  function cancelAnimations(animations) {
    animations.forEach(function (animation) { animation.cancel(); scene.animations.delete(animation); });
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    cameraFrame = null; cameraFlight = null;
  }

  function createOverlay(itemIndex, loadedImage, rect) {
    const overlay = document.createElement('div');
    overlay.className = 'focus-photo';
    overlay.dataset.i = String(itemIndex);
    const shadow = document.createElement('span');
    shadow.className = 'focus-shadow';
    shadow.style.boxShadow = SHADOW_FLOAT;
    overlay.focusShadow = shadow;
    const image = document.createElement('img');
    image.alt = items[itemIndex].title || '';
    image.draggable = false;
    image.decoding = 'async';
    image.src = loadedImage.currentSrc || loadedImage.src || items[itemIndex].file;
    overlay.appendChild(shadow);
    overlay.appendChild(image);
    focusLayer.appendChild(overlay);
    setOverlayRect(overlay, rect);
    upgradeOverlay(overlay, itemIndex);
    return overlay;
  }

  function hideBrick(brick) {
    if (!brick || hiddenBricks.has(brick)) return;
    hiddenBricks.add(brick);
    brick.el.classList.add('is-focus-source');
  }

  function showBrick(brick) {
    if (!brick) return;
    hiddenBricks.delete(brick);
    brick.el.classList.remove('is-focus-source');
  }

  function clearHiddenBricks() {
    hiddenBricks.forEach(function (brick) {
      brick.el.classList.remove('is-focus-source');
    });
    hiddenBricks.clear();
  }

  function primeCloseView() {
    if (scene.mode !== 'focused' || !activePlacement || !activeCamera) return;
    const placement = activePlacement;
    const camera = activeCamera;
    closePreparation = prepareWallForCameras([
      camera,
      wallCameraForPlacement(placement),
    ]).catch(function () {});
  }

  /* ---------- Open, switch, close ---------- */
  async function openPhoto(itemIndex, sourceElement) {
    if (scene.mode !== 'wall' || itemIndex < 0 || itemIndex >= items.length) return;
    const sourceBrick = findBrickByElement(sourceElement);
    if (!sourceBrick) return;

    stopInertia();
    stopWheelInertia();
    closePreparation = null;
    clearNavigationInput();
    const token = sceneStart('opening');
    returnFocus = sourceElement;
    updateLightboxMeta(items[itemIndex]);
    $('#lbStatus').textContent = 'Loading photograph…';
    lightbox.setAttribute('aria-busy', 'true');
    lightbox.hidden = false;
    lightbox.classList.add('is-active');
    stage.inert = true;
    $('#lbClose').focus({ preventScroll: true });

    let loadedImage;
    try {
      loadedImage = await previewPhoto(itemIndex, sourceBrick);
    } catch (_) {
      if (token === scene.token) { finishClose(); $('#wallStatus').textContent = 'Photograph unavailable. Try another image.'; }
      return;
    }
    if (token !== scene.token || scene.mode !== 'opening') return;
    lightbox.removeAttribute('aria-busy');
    $('#lbStatus').textContent = '';

    updateViewport();
    const placement = { brick: sourceBrick, x: sourceBrick.x };
    const sourceCamera = normalCamera();
    const sourceRect = rectForPlacement(placement, sourceCamera);
    const targetCamera = cameraForPlacement(placement);
    const targetRect = floatingRect(placement, targetCamera);

    activeIndex = itemIndex;
    activeOrderPos = Number.isFinite(parseInt(sourceElement.dataset.orderPos, 10))
      ? parseInt(sourceElement.dataset.orderPos, 10)
      : orderPosByItem[itemIndex];
    activePlacement = placement;
    activeCamera = targetCamera;
    activeOverlayRect = targetRect;
    homeAnchorRatio = Math.max(0, Math.min(1,
      (sourceRect.left + sourceRect.width / 2) / Math.max(1, vw)));

    updateLightboxMeta(items[itemIndex]);
    ensureVisibleForCameras([sourceCamera, targetCamera]);
    lightbox.hidden = false;
    stage.inert = true;
    $('#lbClose').focus({ preventScroll: true });
    lightbox.classList.add('is-active');
    lightbox.classList.remove('is-ready');
    setBackdrop(false);

    activeOverlay = createOverlay(itemIndex, loadedImage, sourceRect);
    setOverlayDepth(activeOverlay, 'clear');
    hideBrick(sourceBrick);

    const animations = [
      animateWall(sourceCamera, targetCamera, CAMERA_MOTION_MS),
      animateBackdrop(false, true, CAMERA_MOTION_MS),
      ...animateOverlay(activeOverlay, sourceRect, targetRect, 'clear', 'float', CAMERA_MOTION_MS),
    ];
    await playTogether(animations);
    if (token !== scene.token) return;

    setWallState(targetCamera);
    setBackdrop(true);
    setOverlayRect(activeOverlay, targetRect);
    setOverlayDepth(activeOverlay, 'float');
    cancelAnimations(animations);
    rebaseActiveToMiddleCycle();
    ensureVisibleForCameras([activeCamera, wallCameraForPlacement(activePlacement)]);
    lightbox.classList.add('is-ready');
    scene.set('focused');
    warmPendingNavigation();
    stage.dataset.mode = scene.mode;
    syncPhotoURL(itemIndex);
    primeCloseView();
  }

  function clearNavigationInput() {
    if (navigationBurstTimer !== null) clearTimeout(navigationBurstTimer);
    navigationBurstTimer = null;
    pendingNavigationSteps = 0;
    activeSwitchSteps = 0;
    lightboxWheelDelta = 0;
    lightboxWheelDirection = 0;
    lightboxWheelLastInput = 0;
  }

  function wrappedOrderPos(orderPos) {
    return ((orderPos % items.length) + items.length) % items.length;
  }

  function placementAfterSteps(placement, steps) {
    if (!placement) return null;
    const logical = geometry.at(placement.brick.row, placement.brick.ordinal + steps);
    const brick = mountBrick(logical);
    return { brick, x: logical.x };
  }

  function directSwitchDuration(steps) {
    const distance = Math.max(1, Math.abs(steps));
    if (distance === 1) return SWITCH_MOTION_MS;
    return Math.min(DIRECT_SWITCH_MAX_MS,
      SWITCH_MOTION_MS + Math.log2(distance) * 120);
  }

  function warmPendingNavigation() {
    warmSources.clear();
    if (activeOrderPos < 0 || document.hidden || navigator.connection?.saveData) return;
    const predictedSteps = activeSwitchSteps + pendingNavigationSteps;
    const orderPos = wrappedOrderPos(activeOrderPos + predictedSteps * rowStride);
    // Warm the requested destination, then one neighbour in the last travel direction.
    const positions = pendingNavigationSteps
      ? [orderPos, wrappedOrderPos(orderPos + navigationDirection * rowStride)]
      : [wrappedOrderPos(orderPos + navigationDirection * rowStride)];
    positions.forEach(position => warmSources.add(detailSource(displayOrder[position])));
    pruneImages();
    warmSources.forEach(src => imageLoader.load(src, 2).catch(function () {}));
  }

  function flushNavigationInput() {
    navigationBurstTimer = null;
    if (scene.mode !== 'focused' || !pendingNavigationSteps) return;
    const steps = pendingNavigationSteps;
    pendingNavigationSteps = 0;
    navigate(steps);
  }

  function scheduleNavigationFlight() {
    if (navigationBurstTimer !== null) clearTimeout(navigationBurstTimer);
    navigationBurstTimer = setTimeout(flushNavigationInput, NAVIGATION_BURST_MS);
  }

  function requestNavigation(direction) {
    if (items.length < 2 || (direction !== -1 && direction !== 1)) return;
    if (scene.mode !== 'focused' && scene.mode !== 'switching') return;
    pendingNavigationSteps += direction;
    navigationDirection = direction;
    warmPendingNavigation();
    if (scene.mode === 'focused') scheduleNavigationFlight();
  }

  async function navigate(steps) {
    if (scene.mode !== 'focused' || items.length < 2 || !steps) return;
    const nextPlacement = placementAfterSteps(activePlacement, steps);
    if (!nextPlacement) return;

    const nextOrderPos = wrappedOrderPos(activeOrderPos + steps * rowStride);
    const nextIndex = displayOrder[nextOrderPos];
    const motionMs = directSwitchDuration(steps);
    const token = sceneStart('switching');
    activeSwitchSteps = steps;

    let loadedImage;
    try {
      loadedImage = await previewPhoto(nextIndex, nextPlacement.brick);
    } catch (_) {
      if (token === scene.token) {
        activeSwitchSteps = 0;
        scene.set('focused');
        flushNavigationInput();
      }
      return;
    }
    if (token !== scene.token || scene.mode !== 'switching') return;

    const previousPlacement = activePlacement;
    const previousCamera = activeCamera;
    const previousOverlay = activeOverlay;
    const previousFloatRect = activeOverlayRect;
    const nextCamera = cameraForPlacement(nextPlacement);
    // Keep both wall views warm across a switch. They are off-screen behind the
    // photograph, so recycling them would only pay off as a later remount.
    const wallBefore = wallCameraForPlacement(previousPlacement);
    const wallAfter = wallCameraForPlacement(nextPlacement);
    const pinned = [previousCamera, nextCamera, wallBefore, wallAfter];
    const previousLandingRect = rectForPlacement(previousPlacement, nextCamera);
    const nextStartingRect = rectForPlacement(nextPlacement, previousCamera);
    const nextFloatRect = floatingRect(nextPlacement, nextCamera);

    await prepareWallForCameras(pinned);
    if (token !== scene.token || scene.mode !== 'switching') return;
    const incomingOverlay = createOverlay(nextIndex, loadedImage, nextStartingRect);
    incomingOverlay.style.opacity = '0';
    incomingOverlay.classList.add('incoming');
    previousOverlay.classList.add('outgoing');
    setOverlayDepth(incomingOverlay, 'background');
    showBrick(previousPlacement.brick);
    updateLightboxMeta(items[nextIndex]);

    const animations = [
      animateWall(previousCamera, nextCamera, motionMs, pinned),
      ...animateOverlay(
        previousOverlay,
        previousFloatRect,
        previousLandingRect,
        'float',
        'clear',
        motionMs
      ),
      animateOverlayHandoff(previousOverlay, motionMs),
      ...animateOverlay(
        incomingOverlay,
        nextStartingRect,
        nextFloatRect,
        'background',
        'float',
        motionMs
      ),
      animateOverlayReveal(incomingOverlay, motionMs),
    ];
    await playTogether(animations);
    if (token !== scene.token) return;

    setWallState(nextCamera);
    setOverlayRect(incomingOverlay, nextFloatRect);
    setOverlayDepth(incomingOverlay, 'float');
    incomingOverlay.style.opacity = '1';
    previousOverlay.style.opacity = '0';
    hideBrick(nextPlacement.brick);
    cancelAnimations(animations);
    previousOverlay.remove();
    incomingOverlay.classList.remove('incoming');

    activeIndex = nextIndex;
    activeOrderPos = nextOrderPos;
    activePlacement = nextPlacement;
    activeCamera = nextCamera;
    activeOverlay = incomingOverlay;
    activeOverlayRect = nextFloatRect;
    rebaseActiveToMiddleCycle();
    ensureVisibleForCameras([activeCamera, wallCameraForPlacement(activePlacement)]);
    activeSwitchSteps = 0;
    scene.set('focused');
    warmPendingNavigation();
    stage.dataset.mode = scene.mode;
    syncPhotoURL(nextIndex);
    if (!pendingNavigationSteps) primeCloseView();
    flushNavigationInput();
  }

  function closePhoto() {
    if (closingPromise) return closingPromise;
    if (scene.mode === 'wall') return Promise.resolve();
    closingPromise = performClosePhoto().finally(() => { closingPromise = null; });
    return closingPromise;
  }

  async function performClosePhoto() {
    if (scene.mode === 'wall' || scene.mode === 'closing') return;
    const interrupted = scene.mode !== 'focused';
    const displayedCamera = currentCamera();
    const displayedRect = activeOverlay ? activeOverlay.getBoundingClientRect() : null;
    const token = sceneStart('closing');
    clearNavigationInput();
    cancelAnimations([...scene.animations]);
    if (!activePlacement || !activeOverlay) {
      finishClose(); return;
    }
    if (interrupted) {
      activeCamera = displayedCamera;
      activeOverlayRect = { left: displayedRect.left, top: displayedRect.top,
        width: displayedRect.width, height: displayedRect.height };
      focusLayer.querySelectorAll('.focus-photo').forEach(el => { if (el !== activeOverlay) el.remove(); });
      activeOverlay.classList.remove('outgoing', 'incoming');
      activeOverlay.style.opacity = '1';
      setOverlayRect(activeOverlay, activeOverlayRect);
      setOverlayDepth(activeOverlay, 'float');
      hideBrick(activePlacement.brick);
    }
    lightbox.classList.remove('is-ready');

    const fromCamera = activeCamera;
    const toCamera = wallCameraForPlacement(activePlacement);
    const finalPan = toCamera.tx;
    const fromRect = activeOverlayRect;
    const toRect = rectForPlacement(activePlacement, toCamera);
    const preparedCloseView = closePreparation
      || prepareWallForCameras([fromCamera, toCamera]);
    closePreparation = null;
    await preparedCloseView;
    if (token !== scene.token || scene.mode !== 'closing') return;

    const backdropAnimation = animateBackdrop(true, false, CLOSE_BACKDROP_MS);
    const animations = [
      animateWall(fromCamera, toCamera, CAMERA_MOTION_MS),
      backdropAnimation,
      ...animateOverlay(activeOverlay, fromRect, toRect, 'float', 'clear', CAMERA_MOTION_MS),
    ];
    backdropAnimation.finished.then(function () {
      if (token !== scene.token || scene.mode !== 'closing') return;
      focusBackdrop.style.opacity = '0';
      focusBackdrop.style.backdropFilter = 'none';
      focusBackdrop.style.webkitBackdropFilter = 'none';
      backdropAnimation.cancel();
    }).catch(function () {});
    await playTogether(animations);
    if (token !== scene.token) return;

    setWallState(toCamera);
    setBackdrop(false);
    setOverlayRect(activeOverlay, toRect);
    setOverlayDepth(activeOverlay, 'clear');
    cancelAnimations(animations);

    // The wall transform is normalised into a bounded window; a cycle-nudged
    // pan must move the mounted nodes with it or the next coordination pass
    // would rebuild every visible brick.
    const normalizedFinalPan = normalizedPan(finalPan);
    if (cycleW) {
      const cycles = Math.round((finalPan - normalizedFinalPan) / cycleW);
      if (cycles) shiftWallCycles(cycles);
    }
    pan = normalizedFinalPan;
    // Publish the settled wall first; the landing brick sits under the overlay
    // at exactly this rect, so tearing the overlay and lightbox surfaces down
    // one frame later is pixel-identical and keeps the final raster clean.
    applyPan();
    const closingOverlay = activeOverlay;
    // Drop the full-resolution decode for this photograph; reopening it costs a
    // decode from the HTTP cache instead of keeping a texture for every visit.
    const releasedDetail = activeIndex >= 0 ? detailSource(activeIndex) : null;
    await new Promise(function (resolve) {
      requestAnimationFrame(function () {
        const closingImage = closingOverlay.querySelector('img');
        if (closingImage) closingImage.removeAttribute('src');
        if (releasedDetail) imageLoader.release(releasedDetail);
        if (token !== scene.token || scene.mode !== 'closing') {
          closingOverlay.remove();
          resolve();
          return;
        }
        showBrick(activePlacement.brick);
        closingOverlay.remove();
        activeOverlay = null;
        focusLayer.textContent = '';
        lightbox.hidden = true;
        lightbox.classList.remove('is-active', 'is-ready');
        clearHiddenBricks();
        finishClose();
        resolve();
      });
    });
  }

  function finishClose() {
    swipe.reset(); warmSources.clear();
    activeIndex = -1; activeOrderPos = -1;
    activePlacement = null; activeCamera = null; activeOverlay = null; activeOverlayRect = null;
    closePreparation = null;
    focusLayer.textContent = '';
    clearHiddenBricks();
    clearNavigationInput();
    lightbox.hidden = true; lightbox.classList.remove('is-active', 'is-ready');
    lightbox.removeAttribute('aria-busy');
    stage.inert = false;
    scene.set('wall'); stage.dataset.mode = scene.mode;
    setBackdrop(false); applyPan();
    if (layoutDeferred) { layoutDeferred = false; layout(); }
    else ensureVisibleForCameras([normalCamera()]);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    else stage.focus({ preventScroll: true });
    returnFocus = null;
    syncPhotoURL(null);
    rememberView();
  }

  function syncPhotoURL(index) {
    if (historyUpdating) return;
    const url = new URL(location.href);
    if (index === null) {
      url.hash = '';
      if (historyEntry) { historyEntry = false; history.back(); }
      else history.replaceState(null, '', url);
    } else {
      const hadPhoto = new URLSearchParams(url.hash.slice(1)).has('photo');
      url.hash = new URLSearchParams({ photo: items[index].id }).toString();
      if (hadPhoto) history.replaceState(history.state, '', url);
      else { history.pushState({ gallery: true }, '', url); historyEntry = true; }
      $('#lbPermalink').href = data.build ? new URL('photo/' + encodeURIComponent(items[index].id) + '.html', url).href : url.href;
    }
  }

  async function openFromURL() {
    routePending = true;
    if (routing) return;
    routing = true;
    historyUpdating = true;
    try {
      while (routePending) {
        routePending = false;
        const id = new URLSearchParams(location.hash.slice(1)).get('photo');
        historyEntry = !!(history.state && history.state.gallery);
        if (scene.mode !== 'wall') await closePhoto();
        if (routePending) continue;
        if (id && itemById.has(id)) {
          const index = itemById.get(id);
          const brick = findBrickCopy(0, orderPosByItem[index], 1);
          setPan(vw / 2 - brick.x - brick.w / 2);
          await openPhoto(index, brick.el);
          $('#lbPermalink').href = data.build ? new URL('photo/' + encodeURIComponent(id) + '.html', location.href).href : location.href;
        }
      }
    } finally { historyUpdating = false; routing = false; }
  }
  window.addEventListener('popstate', openFromURL);

  /* ---------- Metadata ---------- */
  function updateLightboxMeta(item) {
    lbTitle.textContent = item.title || 'Untitled';
    $('#lbDescription').textContent = item.description || '';
    $('#lbDescription').hidden = !item.description;
    $('#lbPermalink').hidden = !rawConfig.showShare;
    lbCat.hidden = !item.category;
    if (item.category) lbCat.textContent = '#' + item.category;
    lbChips.textContent = '';
    const exif = item.exif || {};
    const camera = joinParts(exif.make, exif.model);
    if (camera) addChip('Camera', camera);
    if (exif.lens) addChip('Lens', exif.lens);
    if (exif.fnumber) addChip('Aperture', 'f/' + exif.fnumber);
    if (exif.exposure) addChip('Shutter', exif.exposure);
    if (exif.iso) addChip('ISO', exif.iso);
    if (exif.focal) addChip('Focal length', exif.focal);
    if (exif.taken) addChip('Captured', exif.taken);
    if (item.width > 0 && item.height > 0) {
      addChip('Resolution', item.width + ' x ' + item.height);
    }
  }

  function addChip(key, value) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const keyElement = document.createElement('span');
    keyElement.className = 'k';
    keyElement.textContent = key;
    const valueElement = document.createElement('span');
    valueElement.className = 'v';
    valueElement.textContent = value;
    chip.appendChild(keyElement);
    chip.appendChild(valueElement);
    lbChips.appendChild(chip);
  }

  function joinParts() {
    const values = [];
    for (let index = 0; index < arguments.length; index++) {
      if (arguments[index]) values.push(String(arguments[index]).trim());
    }
    return values.join(' ');
  }

  /* ---------- Lightbox and resize events ---------- */
  $('#lbClose').addEventListener('click', closePhoto);
  $('#lbPrev').addEventListener('click', function () { requestNavigation(-1); });
  $('#lbNext').addEventListener('click', function () { requestNavigation(1); });
  lightbox.addEventListener('wheel', beginLightboxWheelNavigation, { passive: false });
  lightbox.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse') {
      if (event.target === lightbox) closePhoto();
      return;
    }
    const eligible = !event.target.closest('button, a, #lbInfo')
      && scene.mode !== 'wall' && scene.mode !== 'closing';
    swipe.down(event.pointerId, event.clientX, event.clientY, event.timeStamp, vw, eligible);
    swipeBackdrop = event.target === lightbox;
    // Capture only an eligible gesture; native pan/pinch can still cancel it.
    if (eligible) { try { lightbox.setPointerCapture(event.pointerId); } catch (_) {} }
  });
  lightbox.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') swipe.move(event.pointerId, event.clientX, event.clientY);
  });
  lightbox.addEventListener('pointerup', event => {
    if (event.pointerType === 'mouse') return;
    const result = swipe.up(event.pointerId, event.clientX, event.clientY, event.timeStamp);
    if (result?.direction) requestNavigation(result.direction);
    else if (result?.tap && swipeBackdrop) closePhoto();
  });
  lightbox.addEventListener('pointercancel', event => swipe.cancel(event.pointerId));
  lightbox.addEventListener('lostpointercapture', event => swipe.cancel(event.pointerId));
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && scene.mode !== 'wall') { event.preventDefault(); closePhoto(); return; }
    if (scene.mode !== 'wall') {
      if (event.key === 'Tab') {
        const controls = [...lightbox.querySelectorAll('button, a[href]')].filter(el => !el.hidden);
        const current = controls.indexOf(document.activeElement);
        event.preventDefault();
        controls[GalleryLayout.mod(current + (event.shiftKey ? -1 : 1), controls.length)].focus();
      } else if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key)) {
        event.preventDefault(); requestNavigation(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault(); requestNavigation(-1);
      }
      return;
    }
    if (!stage.contains(document.activeElement)) return;
    const focused = brickByElement.get(document.activeElement);
    if (event.key === 'Enter' || event.key === ' ') {
      if (focused) { event.preventDefault(); openPhoto(focused.itemIdx, focused.el); }
    } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) {
      event.preventDefault();
      const direction = ['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key) ? -1 : 1;
      const base = focused || findBrickCopy(0, orderPosByItem[keyboardIndex], 1);
      const next = mountBrick(geometry.at(base.row, base.ordinal + direction));
      keyboardIndex = next.itemIdx;
      setPan(vw / 2 - next.x - next.w / 2);
      ensureVisibleForCameras([normalCamera()]);
      const target = bricks.find(b => b.itemIdx === keyboardIndex && b.el.getAttribute('aria-hidden') !== 'true');
      if (target) target.el.focus({ preventScroll: true });
    }
  });

  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (scene.mode === 'wall') {
        layout();
        return;
      }
      if (scene.mode !== 'focused' || !activePlacement) {
        layoutDeferred = true;
        if (scene.mode !== 'closing') closePhoto();
        return;
      }
      updateViewport();
      activeCamera = cameraForPlacement(activePlacement);
      activeOverlayRect = floatingRect(activePlacement, activeCamera);
      setWallState(activeCamera);
      setOverlayRect(activeOverlay, activeOverlayRect);
      ensureVisibleForCameras([activeCamera]);
      layoutDeferred = true;
      closePreparation = null;
      if (activeOverlay) upgradeOverlay(activeOverlay, activeIndex);
    }, 120);
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  function tone(index) {
    const color = items[index].averageColor;
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#d9d9d9';
  }

  setTimeout(function () { hint.classList.add('gone'); }, 7000);
  layout();
  stage.dataset.mode = scene.mode;
  if (location.hash) openFromURL();
  window.addEventListener('pagehide', () => { rememberView(); stopInertia(); stopWheelInertia(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { rememberView(); stopInertia(); stopWheelInertia(); swipe.reset(); imageLoader.pause(); }
    else { imageLoader.resume(); if (scene.mode === 'wall') ensureVisibleForCameras([normalCamera()]); }
  });
})();
