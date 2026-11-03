/* One-finger navigation; vertical gestures and multi-touch never become swipes. */
(function (root) {
  'use strict';
  function create() {
    const pointers = new Set();
    let gesture = null;
    function down(id, x, y, time, width, eligible = true) {
      pointers.add(id);
      if (pointers.size !== 1 || !eligible) { gesture = null; return; }
      gesture = { id, x, y, time, width, axis: null, moved: false };
    }
    function move(id, x, y) {
      if (!gesture || gesture.id !== id) return false;
      const dx = Math.abs(x - gesture.x), dy = Math.abs(y - gesture.y);
      if (Math.max(dx, dy) > 10) {
        gesture.moved = true;
        if (!gesture.axis) gesture.axis = dx > dy * 1.3 ? 'x' : 'y';
      }
      return gesture.axis === 'x';
    }
    function up(id, x, y, time) {
      move(id, x, y);
      const current = gesture;
      pointers.delete(id);
      if (!current || current.id !== id) return null;
      gesture = null;
      const dx = x - current.x, distance = Math.abs(dx);
      const elapsed = Math.max(1, time - current.time);
      const threshold = Math.min(80, Math.max(48, current.width * 0.12));
      const swipe = current.axis === 'x' && (distance >= threshold || (distance >= 28 && elapsed < 350 && distance / elapsed > 0.4));
      return { direction: swipe ? (dx < 0 ? 1 : -1) : 0, tap: !current.moved };
    }
    function cancel(id) { pointers.delete(id); gesture = null; }
    function reset() { pointers.clear(); gesture = null; }
    return { down, move, up, cancel, reset };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GallerySwipe = api;
})(typeof window === 'undefined' ? globalThis : window);
