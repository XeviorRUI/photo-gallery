/* Bounded, prioritized image decoding. Displayed DOM images own their pixels. */
(function (root) {
  'use strict';
  const cancelled = () => Object.assign(new Error('Image no longer needed'), { name: 'AbortError' });
  function create({ concurrency = 4, maxEntries = 48, maxPixels = 36000000, timeout = 10000,
    foregroundSlots = 1, makeImage = () => new Image(), hidden = () => document.hidden,
    staleGrace = 500, clock = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) } = {}) {
    const jobs = new Map();
    const backgroundLimit = Math.max(1, concurrency - foregroundSlots);
    let running = 0, serial = 0, paused = false, cancelledCount = 0;
    function trim() {
      let ready = [...jobs.values()].filter(j => j.image);
      let pixels = ready.reduce((sum, j) => sum + j.pixels, 0);
      ready.sort((a, b) => a.used - b.used);
      while (ready.length && (ready.length > maxEntries || pixels > maxPixels)) {
        const job = ready.shift();
        jobs.delete(job.src);
        pixels -= job.pixels;
      }
    }
    function pump() {
      const queued = [...jobs.values()].filter(j => j.state === 'queued' && (!(paused || hidden()) || j.priority <= 0));
      queued.sort((a, b) => a.priority - b.priority || a.used - b.used);
      while (running < concurrency && queued.length) {
        if (queued[0].priority > 0 && running >= backgroundLimit) break;
        start(queued.shift());
      }
    }
    function start(job) {
      running++;
      job.state = 'loading';
      job.staleAt = 0;
      const image = makeImage();
      job.request = image;
      image.decoding = 'async';
      image.fetchPriority = job.priority <= 0 ? 'high' : job.priority >= 2 ? 'low' : 'auto';
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        image.onload = image.onerror = null;
        job.request = null;
        running--;
        if (error) {
          if (jobs.get(job.src) === job) jobs.delete(job.src);
          image.removeAttribute('src');
          job.reject(error);
        } else {
          job.state = 'ready'; job.image = image;
          job.pixels = image.naturalWidth * image.naturalHeight;
          job.used = ++serial;
          job.resolve(image); trim();
        }
        pump();
      };
      job.cancel = () => finish(cancelled());
      const timer = setTimeout(() => finish(new Error('Image request timed out')), timeout);
      image.onload = () => {
        if (image.decode) image.decode().then(() => finish(), finish);
        else finish();
      };
      image.onerror = () => finish(new Error('Image unavailable'));
      image.src = job.src;
    }
    function load(src, priority = 1) {
      if (!src) return Promise.reject(new Error('Missing image URL'));
      const existing = jobs.get(src);
      if (existing) {
        existing.used = ++serial;
        existing.priority = Math.min(existing.priority, priority);
        if (existing.request && priority <= 0) existing.request.fetchPriority = 'high';
        pump(); return existing.promise;
      }
      const job = { src, priority, state: 'queued', used: ++serial };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      jobs.set(src, job); pump();
      return job.promise;
    }
    function prune(keep) {
      const now = clock();
      for (const [src, job] of jobs) {
        if (keep.has(src)) { job.staleAt = 0; continue; }
        if (job.state === 'queued') {
          jobs.delete(src); job.reject(cancelled()); continue;
        }
        if (job.state !== 'loading') continue;
        // A recycled wall copy often needs the same URL again, so an orphaned
        // request is kept briefly instead of restarting it from zero bytes.
        if (!job.staleAt) { job.staleAt = now; continue; }
        if (now - job.staleAt >= staleGrace) { cancelledCount++; job.cancel(); }
      }
    }
    function release(src) {
      const job = jobs.get(src);
      if (!job) return false;
      if (job.state === 'loading' && job.cancel) {
        jobs.delete(src);
        job.cancel();
        return true;
      }
      if (job.state === 'queued') job.reject(cancelled());
      jobs.delete(src);
      job.state = 'released';
      return true;
    }
    function dispose() {
      for (const job of jobs.values()) {
        if (job.state === 'queued') job.reject(new Error('Loader disposed'));
        job.state = 'disposed';
      }
      for (const job of jobs.values()) if (job.cancel) job.cancel();
      jobs.clear();
    }
    return { load, prune, release, pause: () => { paused = true; }, resume: () => { paused = false; pump(); }, dispose,
      stats: () => ({ entries: jobs.size, running, cancelled: cancelledCount,
        queued: [...jobs.values()].filter(j => j.state === 'queued').length,
        pixels: [...jobs.values()].reduce((sum, j) => sum + (j.pixels || 0), 0) }) };
  }
  const orderedVariants = new WeakMap();
  function source(item, side, detail) {
    const variants = detail ? item.details : item.thumbnails;
    if (Array.isArray(variants) && variants.length) {
      let sorted = orderedVariants.get(variants);
      if (!sorted) { sorted = variants.slice().sort((a, b) => a.side - b.side); orderedVariants.set(variants, sorted); }
      return (sorted.find(v => v.side >= side) || sorted[sorted.length - 1]).file;
    }
    return detail ? item.file : (item.thumb || item.file);
  }
  const api = { create, source };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryImages = api;
})(typeof window === 'undefined' ? globalThis : window);
