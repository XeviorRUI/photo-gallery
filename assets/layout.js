/* Pure geometry: a periodic wall without a DOM-sized catalogue. */
(function (root) {
  'use strict';
  const mod = (n, d) => ((n % d) + d) % d;
  function create(widths, rows, height, gap, padding) {
    const count = widths.length;
    const cycleWidth = widths.reduce((sum, w) => sum + w + gap, 0);
    const definitions = new Map(rows.map(row => {
      const prefix = [0];
      for (let i = 0; i < count; i++) prefix.push(prefix[i] + widths[mod(row.offset + i, count)] + gap);
      return [row.row, { ...row, prefix }];
    }));
    function at(rowId, ordinal) {
      const row = definitions.get(rowId);
      const position = mod(ordinal, count);
      const cycle = Math.floor(ordinal / count);
      const orderPos = mod(row.offset + position, count);
      return { key: rowId + ':' + ordinal, row: rowId, ordinal, cycle, orderPos,
        x: padding + cycle * cycleWidth + row.prefix[position], y: row.y,
        w: widths[orderPos], h: height, decorative: row.decorative };
    }
    function copy(rowId, orderPos, cycle) {
      return at(rowId, cycle * count + mod(orderPos - definitions.get(rowId).offset, count));
    }
    function query(left, right, top = -Infinity, bottom = Infinity) {
      if (!count || !cycleWidth) return [];
      const result = [];
      for (const row of definitions.values()) {
        if (row.y + height < top || row.y > bottom) continue;
        let cycle = Math.floor((left - padding) / cycleWidth);
        const local = left - padding - cycle * cycleWidth;
        let low = 0, high = count;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (row.prefix[mid + 1] < local) low = mid + 1;
          else high = mid;
        }
        let ordinal = cycle * count + Math.min(low, count - 1);
        for (let brick = at(row.row, ordinal); brick.x <= right; brick = at(row.row, ++ordinal)) {
          if (brick.x + brick.w >= left) result.push(brick);
        }
      }
      return result;
    }
    return { at, copy, query, cycleWidth, count };
  }
  const api = { create, mod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryLayout = api;
})(typeof window === 'undefined' ? globalThis : window);
