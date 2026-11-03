(function (root) {
  'use strict';
  function normalize(data) {
    const ids = new Set();
    return (data && Array.isArray(data.items) ? data.items : []).filter(item => item && typeof item.file === 'string')
      .map(item => {
        let id = String(item.id || item.file);
        if (ids.has(id)) id += ':' + item.file;
        ids.add(id);
        return { ...item, id,
          tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : [],
          width: Number.isFinite(Number(item.width)) && Number(item.width) > 0 ? Number(item.width) : 1,
          height: Number.isFinite(Number(item.height)) && Number(item.height) > 0 ? Number(item.height) : 1 };
      });
  }
  function shuffledIndices(items, seed, curated) {
    const list = items.map((_, i) => i);
    if (curated) return list.sort((a, b) => (items[a].order ?? Infinity) - (items[b].order ?? Infinity));
    let state = seed >>> 0;
    for (let i = list.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = Math.floor(state / 4294967296 * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
  function read(storage, key) { try { return JSON.parse(storage.getItem(key)); } catch (_) { return null; } }
  function write(storage, key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch (_) {} }
  const api = { normalize, shuffledIndices, read, write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryCatalog = api;
})(typeof window === 'undefined' ? globalThis : window);
