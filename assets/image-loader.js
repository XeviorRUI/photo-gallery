/* Bounded, prioritized image decoding. Displayed DOM images own their pixels. */
(function (root) {
  'use strict';
  const cancelled = () => Object.assign(new Error('Image no longer needed'), { name: 'AbortError' });
  function create({ concurrency = 4, maxEntries = 48, maxPixels = 36000000, timeout = 10000,
    makeImage = () => new Image(), hidden = () => document.hidden } = {}) {
    const jobs = new Map();
    let running = 0, serial = 0;
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
      const queued = [...jobs.values()].filter(j => j.state === 'queued' && (!hidden() || j.priority <= 0));
      queued.sort((a, b) => a.priority - b.priority || a.used - b.used);
      while (running < concurrency && queued.length) start(queued.shift());
    }
    function start(job) {
      running++;
      job.state = 'loading';
      const image = makeImage();
      image.decoding = 'async';
      image.fetchPriority = job.priority <= 0 ? 'high' : job.priority >= 2 ? 'low' : 'auto';
      let done = false;
      const finish = (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        image.onload = image.onerror = null;
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
        pump(); return existing.promise;
      }
      const job = { src, priority, state: 'queued', used: ++serial };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      jobs.set(src, job); pump();
      return job.promise;
    }
    function prune(keep) {
      for (const [src, job] of jobs) {
        if (job.state === 'queued' && !keep.has(src)) {
          jobs.delete(src); job.reject(cancelled());
        }
      }
    }
    function dispose() {
      for (const job of jobs.values()) {
        if (job.state === 'queued') job.reject(new Error('Loader disposed'));
        job.state = 'disposed';
      }
      for (const job of jobs.values()) if (job.cancel) job.cancel();
      jobs.clear();
    }
    return { load, prune, resume: pump, dispose,
      stats: () => ({ entries: jobs.size, running,
        pixels: [...jobs.values()].reduce((sum, j) => sum + (j.pixels || 0), 0) }) };
  }
  function source(item, side, detail) {
    const variants = detail ? item.details : item.thumbnails;
    if (Array.isArray(variants) && variants.length) {
      const sorted = variants.slice().sort((a, b) => a.side - b.side);
      return (sorted.find(v => v.side >= side) || sorted[sorted.length - 1]).file;
    }
    return detail ? item.file : (item.thumb || item.file);
  }
  const api = { create, source };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryImages = api;
})(typeof window === 'undefined' ? globalThis : window);
