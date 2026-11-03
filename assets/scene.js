/* Legal scene transitions and cancellation ownership, independent of animation geometry. */
(function (root) {
  'use strict';
  const transitions = {
    wall: ['opening'], opening: ['focused', 'closing', 'wall'],
    focused: ['switching', 'closing'], switching: ['focused', 'closing'], closing: ['wall']
  };
  function create(onChange = () => {}) {
    let mode = 'wall', token = 0, controller = null;
    function set(next) {
      if (next === mode) return;
      if (!transitions[mode].includes(next)) throw new Error('Invalid scene transition: ' + mode + ' → ' + next);
      mode = next; onChange(mode);
    }
    function begin(next) {
      set(next);
      if (controller) controller.abort();
      controller = new AbortController();
      return ++token;
    }
    return { set, begin, animations: new Set(), get mode() { return mode; },
      get token() { return token; }, get signal() { return controller && controller.signal; } };
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GalleryScene = api;
})(typeof window === 'undefined' ? globalThis : window);
