/* Pure geometry: a periodic wall without a DOM-sized catalogue. */
(function (root) {
  'use strict';
  const mod = (n, d) => ((n % d) + d) % d;
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; };
  const inverse = (value, modulo) => {
    let [oldR, r] = [mod(value, modulo), modulo];
    let [oldS, s] = [1, 0];
    while (r) {
      const q = Math.floor(oldR / r);
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
    }
    return oldR === 1 ? mod(oldS, modulo) : null;
  };
  function create(widths, rows, height, gap, padding) {
    const count = widths.length;
    const cycleWidth = widths.reduce((sum, w) => sum + w + gap, 0);
    const definitions = new Map(rows.map(row => {
      // `stride` deals the catalogue across columns instead of repeating the
      // same sequence on every row. A stride that is not coprime with the
      // catalogue would make a row show only part of it, so it falls back to 1.
      const stride = row.stride && gcd(row.stride, count) === 1 ? row.stride : 1;
      // Every row repeats over the same catalogue width. If all rows start
      // that repeat at the same x, the gutter at the catalogue boundary lines
      // up into one vertical seam, so shift each row's cycle by a stable phase.
      const phaseX = ((((Number(row.phase) || 0) % 1) + 1) % 1) * cycleWidth;
      const order = new Array(count);
      const prefix = [0];
      for (let i = 0; i < count; i++) {
        order[i] = mod(row.offset + i * stride, count);
        prefix.push(prefix[i] + widths[order[i]] + gap);
      }
      return [row.row, { ...row, stride, phaseX, order, prefix, inverse: inverse(stride, count) }];
    }));
    const maxPhase = Math.max(0, ...Array.from(definitions.values(), row => row.phaseX));
    function at(rowId, ordinal) {
      const row = definitions.get(rowId);
      const position = mod(ordinal, count);
      const cycle = Math.floor(ordinal / count);
      const orderPos = row.order[position];
      return { key: rowId + ':' + ordinal, row: rowId, ordinal, cycle, orderPos,
        x: padding + row.phaseX + cycle * cycleWidth + row.prefix[position], y: row.y,
        w: widths[orderPos], h: height, decorative: row.decorative };
    }
    function positionOf(row, orderPos) {
      if (row.inverse !== null) return mod((orderPos - row.offset) * row.inverse, count);
      const target = mod(orderPos, count);
      for (let i = 0; i < count; i++) if (row.order[i] === target) return i;
      return 0;
    }
    function copy(rowId, orderPos, cycle) {
      const row = definitions.get(rowId);
      return at(rowId, cycle * count + positionOf(row, orderPos));
    }
    function query(left, right, top = -Infinity, bottom = Infinity) {
      const result = [];
      visit(left, right, top, bottom, (row, ordinal) => result.push(at(row, ordinal)));
      return result;
    }
    // Visit logical positions without allocating a descriptor for every frame.
    function visit(left, right, top, bottom, callback) {
      if (!count || !cycleWidth) return;
      for (const row of definitions.values()) {
        if (row.y + height < top || row.y > bottom) continue;
        const base = padding + row.phaseX;
        let cycle = Math.floor((left - base) / cycleWidth);
        const local = left - base - cycle * cycleWidth;
        let low = 0, high = count;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (row.prefix[mid + 1] < local) low = mid + 1;
          else high = mid;
        }
        let position = Math.min(low, count - 1);
        let ordinal = cycle * count + position;
        let x = base + cycle * cycleWidth + row.prefix[position];
        while (x <= right) {
          const width = widths[row.order[position]];
          if (x + width >= left) callback(row.row, ordinal);
          x += width + gap;
          ordinal++; position = mod(position + 1, count);
        }
      }
    }
    return { at, copy, query, visit, cycleWidth, count, maxPhase };
  }
  const api = { create, mod, gcd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryLayout = api;
})(typeof window === 'undefined' ? globalThis : window);
