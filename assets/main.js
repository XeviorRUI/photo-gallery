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
  const REPEAT_COUNT = 3;
  const MIDDLE_CYCLE = 1;
  const CAMERA_MOTION_MS = 820;
  const SWITCH_MOTION_MS = 680;
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
  const WALL_CLEAR_FILTER = 'blur(0px)';
  const WALL_FOCUS_FILTER = 'blur(3px)';
  const SHADE_CLEAR = lightTheme ? 'rgba(255, 255, 255, 0)' : 'rgba(5, 7, 6, 0)';
  const SHADE_FOCUS = lightTheme ? 'rgba(255, 255, 255, 0.48)' : 'rgba(5, 7, 6, 0.27)';
  const SHADOW_FLAT = '0 0 0 rgba(0, 0, 0, 0)';
  const SHADOW_FLOAT = lightTheme
    ? '0 14px 22px -14px rgba(25, 30, 28, 0.34)'
    : '0 15px 24px -14px rgba(0, 0, 0, 0.78)';
  const PHOTO_CLEAR_FILTER = 'blur(0px) brightness(1) saturate(1)';
  const PHOTO_BACKGROUND_FILTER = lightTheme
    ? 'blur(3px) brightness(1.2) contrast(0.82) saturate(0.72)'
    : 'blur(3px) brightness(0.54) saturate(0.82)';
  const reducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (selector, root) => (root || document).querySelector(selector);

  const stage = $('#stage');
  const wallViewport = $('#wallViewport');
  const wall = $('#wall');
  const emptyState = $('#emptyState');
  const metaEl = $('#wallMeta');
  const hint = $('#hint');
  const siteTitle = $('#siteTitle');
  const siteSubtitle = $('#siteSubtitle');
  const lightbox = $('#lightbox');
  const focusLayer = $('#focusLayer');
  const lbTitle = $('#lbTitle');
  const lbCat = $('#lbCat');
  const lbChips = $('#lbChips');

  const data = (typeof window.GALLERY_DATA !== 'undefined' && window.GALLERY_DATA) || null;
  const items = (data && Array.isArray(data.items)) ? data.items : [];
  const bricks = [];
  const brickByElement = new WeakMap();
  const hiddenBricks = new Set();
  const preloadCache = new Map();

  let displayOrder = [];
  let orderPosByItem = [];
  let vw = 0;
  let vh = 0;
  let padTop = 0;
  let rowCount = 0;
  let rowH = 0;
  let cycleW = 0;
  let contentW = 0;
  let pan = 0;
  let laidOut = false;
  let relayoutQueued = false;
  let layoutDeferred = false;
  let visibilityCheckId = null;
  let lastVisibilityPan = NaN;
  let inertiaId = null;
  let wheelInertiaId = null;
  let wheelVelocity = 0;
  let wheelTargetVelocity = 0;
  let wheelLastFrame = 0;
  let wheelLastInput = 0;
  let interaction = null;
  let dragMoved = false;
  let suppressClickUntil = 0;
  let touchActive = false;

  let viewMode = 'wall';
  let sceneToken = 0;
  let activeIndex = -1;
  let activeOrderPos = -1;
  let activePlacement = null;
  let activeCamera = null;
  let activeOverlay = null;
  let activeOverlayRect = null;
  let homeAnchorRatio = 0.5;

  applySiteConfig();

  if (!items.length) {
    metaEl.textContent = '0 photographs';
    emptyState.hidden = false;
    return;
  }

  displayOrder = items.map(function (_, index) { return index; });
  shuffle(displayOrder);
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

  function layout() {
    if (viewMode !== 'wall' || !updateViewport()) return;

    emptyState.hidden = true;
    clearHiddenBricks();
    const oldCycleW = cycleW;
    const oldProgress = oldCycleW > 0 ? pan / oldCycleW : -1;

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
    cycleW = widths.reduce(function (sum, width) { return sum + width; }, 0)
      + GAP * items.length;
    contentW = PAD_X * 2 + REPEAT_COUNT * cycleW;

    wall.textContent = '';
    bricks.length = 0;
    wall.style.width = contentW + 'px';
    wall.style.height = vh + 'px';

    const offsetStep = Math.max(1, Math.floor(items.length / Math.max(1, rowCount)));
    const rowDefinitions = [{
      row: -1,
      y: padTop - GAP - rowH,
      offset: (items.length - offsetStep) % items.length,
      decorative: true,
    }];
    for (let row = 0; row < rowCount; row++) {
      rowDefinitions.push({
        row: row,
        y: padTop + row * (rowH + GAP),
        offset: (row * offsetStep) % items.length,
        decorative: false,
      });
    }
    rowDefinitions.push({
      row: rowCount,
      y: padTop + rowCount * (rowH + GAP),
      offset: (rowCount * offsetStep) % items.length,
      decorative: true,
    });

    rowDefinitions.forEach(function (rowDefinition) {
      const rowOffset = rowDefinition.offset;
      const y = rowDefinition.y;

      for (let cycle = 0; cycle < REPEAT_COUNT; cycle++) {
        let x = PAD_X + cycle * cycleW;

        for (let position = 0; position < items.length; position++) {
          const orderPos = (rowOffset + position) % items.length;
          const itemIndex = displayOrder[orderPos];
          const width = widths[orderPos];
          const element = document.createElement('div');
          element.className = rowDefinition.decorative ? 'brick decorative' : 'brick';
          element.dataset.i = String(itemIndex);
          element.dataset.orderPos = String(orderPos);
          element.dataset.row = String(rowDefinition.row);
          element.dataset.cycle = String(cycle);
          if (rowDefinition.decorative) element.setAttribute('aria-hidden', 'true');
          element.style.width = width + 'px';
          element.style.height = rowH + 'px';
          element.style.background = tone(itemIndex);
          element.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';

          const image = document.createElement('img');
          image.alt = items[itemIndex].title || '';
          image.draggable = false;
          image.decoding = 'async';
          image.addEventListener('load', onBrickImageLoad);
          image.addEventListener('error', onBrickImageError);
          element.appendChild(image);
          wall.appendChild(element);

          const brick = {
            el: element,
            img: image,
            itemIdx: itemIndex,
            orderPos: orderPos,
            row: rowDefinition.row,
            cycle: cycle,
            x: x,
            y: y,
            w: width,
            h: rowH,
            decorative: rowDefinition.decorative,
            srcOn: false,
          };
          bricks.push(brick);
          brickByElement.set(element, brick);

          x += width + GAP;
        }
      }
    });

    pan = laidOut && oldCycleW > 0 ? oldProgress * cycleW : -cycleW;
    laidOut = true;
    applyPan();
    requestAnimationFrame(function () {
      bricks.forEach(function (brick) { brick.el.classList.add('ready'); });
    });
    ensureVisibleForCameras([normalCamera()]);
    lastVisibilityPan = pan;
  }

  function itemAspect(item) {
    if (item && item.width > 0 && item.height > 0) return item.width / item.height;
    return 1;
  }

  function normalizedPan(value) {
    if (!cycleW) return value;
    while (value > 0) value -= cycleW;
    while (value <= -2 * cycleW) value += cycleW;
    return value;
  }

  function applyPan() {
    pan = normalizedPan(pan);
    wall.style.transform = cameraTransform(normalCamera());
  }

  function setPan(nextPan) {
    pan = normalizedPan(nextPan);
    applyPan();
    scheduleVisibilityCheck();
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
    if (viewMode !== 'wall') return;
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
    let currentVelocity = velocity;
    let lastTime = performance.now();
    const step = function (now) {
      const deltaTime = Math.min(50, now - lastTime);
      lastTime = now;
      setPan(pan + currentVelocity * (deltaTime / 16.7));
      currentVelocity *= Math.pow(0.95, deltaTime / 16.7);
      if (Math.abs(currentVelocity) > 0.08) inertiaId = requestAnimationFrame(step);
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
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;
    else if (event.deltaMode === 2) delta *= vh || window.innerHeight;
    return Math.max(-160, Math.min(160, delta));
  }

  function beginWheelMotion(event) {
    if (viewMode !== 'wall' || event.ctrlKey) return;
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

  function stepWheelMotion(now) {
    if (viewMode !== 'wall') {
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

  stage.addEventListener('mousedown', function (event) { beginInteraction(event, false); });
  stage.addEventListener('wheel', beginWheelMotion, { passive: false });
  window.addEventListener('mousemove', function (event) { moveInteraction(event, false); });
  window.addEventListener('mouseup', function (event) { endInteraction(event, false); });
  stage.addEventListener('touchstart', function (event) {
    if (event.touches.length !== 1) return;
    touchActive = true;
    beginInteraction(event, true);
  }, { passive: false });
  window.addEventListener('touchmove', function (event) {
    if (touchActive) moveInteraction(event, true);
  }, { passive: false });
  window.addEventListener('touchend', function (event) {
    if (!touchActive) return;
    endInteraction(event, true);
    touchActive = false;
  }, { passive: false });
  window.addEventListener('touchcancel', function () {
    interaction = null;
    dragMoved = false;
    touchActive = false;
    stage.classList.remove('panning');
  }, { passive: false });
  stage.addEventListener('click', function (event) {
    if (viewMode !== 'wall' || performance.now() < suppressClickUntil) return;
    const element = event.target && event.target.closest
      ? event.target.closest('.brick')
      : null;
    if (element) openPhoto(parseInt(element.dataset.i, 10), element);
  });

  /* ---------- Image loading ---------- */
  function ensureVisibleForCameras(cameras) {
    if (!bricks.length || !cycleW || !cameras.length) return;
    const ranges = cameras.map(function (camera) {
      const scale = Math.max(0.01, camera.scale);
      const margin = vw * PREFETCH / scale;
      return {
        left: -camera.tx / scale - margin,
        right: (vw - camera.tx) / scale + margin,
      };
    });

    bricks.forEach(function (brick) {
      const visible = ranges.some(function (range) {
        return brick.x + brick.w >= range.left && brick.x <= range.right;
      });
      if (!visible) {
        if (brick.srcOn && !hiddenBricks.has(brick)) {
          brick.img.removeAttribute('src');
          brick.img.classList.remove('in', 'broken');
          brick.srcOn = false;
        }
        return;
      }
      if (brick.srcOn) return;
      brick.srcOn = true;
      brick.img.src = items[brick.itemIdx].thumb || items[brick.itemIdx].file;
    });
  }

  function scheduleVisibilityCheck() {
    const threshold = Math.max(72, vw * 0.1);
    if (Number.isFinite(lastVisibilityPan)
      && Math.abs(pan - lastVisibilityPan) < threshold) return;
    if (visibilityCheckId) return;

    visibilityCheckId = requestAnimationFrame(function () {
      visibilityCheckId = null;
      if (viewMode !== 'wall') return;
      ensureVisibleForCameras([normalCamera()]);
      lastVisibilityPan = pan;
    });
  }

  function onBrickImageLoad(event) {
    const image = event.currentTarget;
    image.classList.add('in');
    const brickElement = image.closest('.brick');
    const brick = brickElement ? brickByElement.get(brickElement) : null;
    if (!brick) return;
    const item = items[brick.itemIdx];
    if (item.width > 0 && item.height > 0) return;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      item.width = image.naturalWidth;
      item.height = image.naturalHeight;
      queueRelayout();
    }
  }

  function onBrickImageError(event) {
    event.currentTarget.classList.add('broken');
  }

  function queueRelayout() {
    if (relayoutQueued) return;
    if (viewMode !== 'wall') {
      layoutDeferred = true;
      return;
    }
    relayoutQueued = true;
    requestAnimationFrame(function () {
      relayoutQueued = false;
      layout();
    });
  }

  function preloadPhoto(itemIndex) {
    if (preloadCache.has(itemIndex)) return preloadCache.get(itemIndex);
    const promise = new Promise(function (resolve, reject) {
      const image = new Image();
      image.decoding = 'async';
      image.alt = items[itemIndex].title || '';
      image.onload = function () {
        const finish = function () { resolve(image); };
        if (image.decode) image.decode().catch(function () {}).then(finish);
        else finish();
      };
      image.onerror = reject;
      image.src = items[itemIndex].file;
    });
    preloadCache.set(itemIndex, promise);
    promise.then(
      function () { preloadCache.delete(itemIndex); },
      function () { preloadCache.delete(itemIndex); }
    );
    return promise;
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
    const scale = Math.max(1.08, Math.min(7, Math.min(scaleByWidth, scaleByHeight)));
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
    return bricks.find(function (brick) {
      return brick.row === row && brick.orderPos === orderPos && brick.cycle === cycle;
    }) || null;
  }

  function adjacentPlacement(placement, direction) {
    if (!placement || items.length < 2) return null;
    const nextOrderPos = (placement.brick.orderPos + direction + items.length) % items.length;
    const exemplar = bricks.find(function (brick) {
      return brick.row === placement.brick.row && brick.orderPos === nextOrderPos;
    });
    if (!exemplar) return null;

    const nextX = direction > 0
      ? placement.x + placement.brick.w + GAP
      : placement.x - exemplar.w - GAP;
    const copies = bricks.filter(function (brick) {
      return brick.row === placement.brick.row && brick.orderPos === nextOrderPos;
    });
    let closest = copies[0];
    copies.forEach(function (brick) {
      if (Math.abs(brick.x - nextX) < Math.abs(closest.x - nextX)) closest = brick;
    });
    return { brick: closest, x: nextX };
  }

  function rebaseActiveToMiddleCycle() {
    if (!activePlacement || !activeCamera) return;
    const middle = findBrickCopy(
      activePlacement.brick.row,
      activePlacement.brick.orderPos,
      MIDDLE_CYCLE
    );
    if (!middle || (middle === activePlacement.brick && middle.x === activePlacement.x)) return;

    const previous = activePlacement;
    const adjustedCamera = {
      tx: activeCamera.tx + activeCamera.scale * (previous.x - middle.x),
      ty: activeCamera.ty,
      scale: activeCamera.scale,
    };

    showBrick(previous.brick);
    hideBrick(middle);
    activePlacement = { brick: middle, x: middle.x };
    activeCamera = adjustedCamera;
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

  function animateWall(fromCamera, toCamera, milliseconds) {
    setWallState(fromCamera);
    return wall.animate([
      { transform: cameraTransform(fromCamera) },
      { transform: cameraTransform(toCamera) },
    ], animationOptions(milliseconds));
  }

  function setBackdrop(focused) {
    lightbox.style.backgroundColor = focused ? SHADE_FOCUS : SHADE_CLEAR;
  }

  function animateBackdrop(fromFocused, toFocused, milliseconds) {
    setBackdrop(fromFocused);
    return lightbox.animate([
      {
        backgroundColor: fromFocused ? SHADE_FOCUS : SHADE_CLEAR,
      },
      {
        backgroundColor: toFocused ? SHADE_FOCUS : SHADE_CLEAR,
      },
    ], animationOptions(milliseconds));
  }

  function setWallEffect(focused) {
    wallViewport.style.filter = focused ? WALL_FOCUS_FILTER : WALL_CLEAR_FILTER;
  }

  function animateWallEffect(fromFocused, toFocused, milliseconds) {
    setWallEffect(fromFocused);
    return wallViewport.animate([
      { filter: fromFocused ? WALL_FOCUS_FILTER : WALL_CLEAR_FILTER },
      { filter: toFocused ? WALL_FOCUS_FILTER : WALL_CLEAR_FILTER },
    ], animationOptions(milliseconds));
  }

  function depthStyle(depth) {
    if (depth === 'float') return { shadow: SHADOW_FLOAT, filter: PHOTO_CLEAR_FILTER };
    if (depth === 'background') return { shadow: SHADOW_FLAT, filter: PHOTO_BACKGROUND_FILTER };
    return { shadow: SHADOW_FLAT, filter: PHOTO_CLEAR_FILTER };
  }

  function setOverlayRect(overlay, rect) {
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.transform = 'translate3d(' + rect.left + 'px,' + rect.top + 'px,0)';
  }

  function setOverlayDepth(overlay, depth) {
    const style = depthStyle(depth);
    overlay.style.boxShadow = style.shadow;
    overlay.style.filter = style.filter;
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
    overlay.style.boxShadow = fromStyle.shadow;
    overlay.style.filter = fromStyle.filter;
    return overlay.animate([
      {
        transform: overlayTransform(fromRect, fromRect),
        boxShadow: fromStyle.shadow,
        filter: fromStyle.filter,
      },
      {
        transform: overlayTransform(toRect, fromRect),
        boxShadow: toStyle.shadow,
        filter: toStyle.filter,
      },
    ], animationOptions(milliseconds));
  }

  async function playTogether(animations) {
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
    animations.forEach(function (animation) { animation.cancel(); });
  }

  function createOverlay(itemIndex, loadedImage, rect) {
    const overlay = document.createElement('div');
    overlay.className = 'focus-photo';
    overlay.dataset.i = String(itemIndex);
    const image = document.createElement('img');
    image.alt = items[itemIndex].title || '';
    image.draggable = false;
    image.decoding = 'async';
    image.src = loadedImage.currentSrc || loadedImage.src || items[itemIndex].file;
    overlay.appendChild(image);
    focusLayer.appendChild(overlay);
    setOverlayRect(overlay, rect);
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

  /* ---------- Open, switch, close ---------- */
  async function openPhoto(itemIndex, sourceElement) {
    if (viewMode !== 'wall' || itemIndex < 0 || itemIndex >= items.length) return;
    const sourceBrick = findBrickByElement(sourceElement);
    if (!sourceBrick) return;

    stopInertia();
    stopWheelInertia();
    viewMode = 'opening';
    const token = ++sceneToken;

    let loadedImage;
    try {
      loadedImage = await preloadPhoto(itemIndex);
    } catch (_) {
      if (token === sceneToken) viewMode = 'wall';
      return;
    }
    if (token !== sceneToken || viewMode !== 'opening') return;

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
    lightbox.classList.add('is-active');
    lightbox.classList.remove('is-ready');
    setBackdrop(false);
    setWallEffect(false);

    activeOverlay = createOverlay(itemIndex, loadedImage, sourceRect);
    setOverlayDepth(activeOverlay, 'clear');
    hideBrick(sourceBrick);

    const animations = [
      animateWall(sourceCamera, targetCamera, CAMERA_MOTION_MS),
      animateBackdrop(false, true, CAMERA_MOTION_MS),
      animateWallEffect(false, true, CAMERA_MOTION_MS),
      animateOverlay(activeOverlay, sourceRect, targetRect, 'clear', 'float', CAMERA_MOTION_MS),
    ];
    await playTogether(animations);
    if (token !== sceneToken) return;

    setWallState(targetCamera);
    setBackdrop(true);
    setWallEffect(true);
    setOverlayRect(activeOverlay, targetRect);
    setOverlayDepth(activeOverlay, 'float');
    cancelAnimations(animations);
    rebaseActiveToMiddleCycle();
    ensureVisibleForCameras([activeCamera, wallCameraForPlacement(activePlacement)]);
    lightbox.classList.add('is-ready');
    viewMode = 'focused';
  }

  async function navigate(direction) {
    if (viewMode !== 'focused' || items.length < 2) return;
    const nextPlacement = adjacentPlacement(activePlacement, direction);
    if (!nextPlacement) return;

    const nextOrderPos = (activeOrderPos + direction + items.length) % items.length;
    const nextIndex = displayOrder[nextOrderPos];
    viewMode = 'switching';
    const token = ++sceneToken;

    let loadedImage;
    try {
      loadedImage = await preloadPhoto(nextIndex);
    } catch (_) {
      if (token === sceneToken) viewMode = 'focused';
      return;
    }
    if (token !== sceneToken || viewMode !== 'switching') return;

    const previousPlacement = activePlacement;
    const previousCamera = activeCamera;
    const previousOverlay = activeOverlay;
    const previousFloatRect = activeOverlayRect;
    const nextCamera = cameraForPlacement(nextPlacement);
    const previousLandingRect = rectForPlacement(previousPlacement, nextCamera);
    const nextStartingRect = rectForPlacement(nextPlacement, previousCamera);
    const nextFloatRect = floatingRect(nextPlacement, nextCamera);

    ensureVisibleForCameras([previousCamera, nextCamera]);
    const incomingOverlay = createOverlay(nextIndex, loadedImage, nextStartingRect);
    incomingOverlay.classList.add('incoming');
    previousOverlay.classList.add('outgoing');
    setOverlayDepth(incomingOverlay, 'background');
    hideBrick(nextPlacement.brick);
    updateLightboxMeta(items[nextIndex]);

    const animations = [
      animateWall(previousCamera, nextCamera, SWITCH_MOTION_MS),
      animateOverlay(
        previousOverlay,
        previousFloatRect,
        previousLandingRect,
        'float',
        'background',
        SWITCH_MOTION_MS
      ),
      animateOverlay(
        incomingOverlay,
        nextStartingRect,
        nextFloatRect,
        'background',
        'float',
        SWITCH_MOTION_MS
      ),
    ];
    await playTogether(animations);
    if (token !== sceneToken) return;

    setWallState(nextCamera);
    setOverlayRect(incomingOverlay, nextFloatRect);
    setOverlayDepth(incomingOverlay, 'float');
    cancelAnimations(animations);
    showBrick(previousPlacement.brick);
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
    viewMode = 'focused';
  }

  async function closePhoto() {
    if (viewMode !== 'focused' || !activePlacement || !activeOverlay) return;
    viewMode = 'closing';
    const token = ++sceneToken;
    lightbox.classList.remove('is-ready');

    const fromCamera = activeCamera;
    const toCamera = wallCameraForPlacement(activePlacement);
    const finalPan = toCamera.tx;
    const fromRect = activeOverlayRect;
    const toRect = rectForPlacement(activePlacement, toCamera);
    ensureVisibleForCameras([fromCamera, toCamera]);

    const animations = [
      animateWall(fromCamera, toCamera, CAMERA_MOTION_MS),
      animateBackdrop(true, false, CAMERA_MOTION_MS),
      animateWallEffect(true, false, CAMERA_MOTION_MS),
      animateOverlay(activeOverlay, fromRect, toRect, 'float', 'clear', CAMERA_MOTION_MS),
    ];
    await playTogether(animations);
    if (token !== sceneToken) return;

    setWallState(toCamera);
    setBackdrop(false);
    setWallEffect(false);
    setOverlayRect(activeOverlay, toRect);
    setOverlayDepth(activeOverlay, 'clear');
    cancelAnimations(animations);

    pan = finalPan;
    showBrick(activePlacement.brick);
    activeOverlay.remove();
    activeOverlay = null;
    focusLayer.textContent = '';
    lightbox.hidden = true;
    lightbox.classList.remove('is-active', 'is-ready');
    clearHiddenBricks();

    activeIndex = -1;
    activeOrderPos = -1;
    activePlacement = null;
    activeCamera = null;
    activeOverlayRect = null;
    viewMode = 'wall';
    applyPan();

    if (layoutDeferred) {
      layoutDeferred = false;
      layout();
    } else {
      ensureVisibleForCameras([normalCamera()]);
    }
  }

  /* ---------- Metadata ---------- */
  function updateLightboxMeta(item) {
    lbTitle.textContent = item.title || 'Untitled';
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
  $('#lbPrev').addEventListener('click', function () { navigate(-1); });
  $('#lbNext').addEventListener('click', function () { navigate(1); });
  lightbox.addEventListener('pointerdown', function (event) {
    if (event.target === lightbox) closePhoto();
  });
  document.addEventListener('keydown', function (event) {
    if (viewMode !== 'focused') return;
    if (event.key === 'Escape') closePhoto();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') navigate(1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') navigate(-1);
  });

  let resizeTimer = null;
  function handleResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (viewMode === 'wall') {
        layout();
        return;
      }
      if (viewMode !== 'focused' || !activePlacement) {
        layoutDeferred = true;
        return;
      }
      updateViewport();
      activeCamera = cameraForPlacement(activePlacement);
      activeOverlayRect = floatingRect(activePlacement, activeCamera);
      setWallState(activeCamera);
      setOverlayRect(activeOverlay, activeOverlayRect);
      ensureVisibleForCameras([activeCamera]);
      layoutDeferred = true;
    }, 120);
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);

  function shuffle(list) {
    for (let index = list.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const value = list[index];
      list[index] = list[randomIndex];
      list[randomIndex] = value;
    }
  }

  function tone(index) {
    return 'hsl(' + ((index * 137.508) % 360 | 0) + ',42%,19%)';
  }

  setTimeout(function () { hint.classList.add('gone'); }, 7000);
  layout();
})();
