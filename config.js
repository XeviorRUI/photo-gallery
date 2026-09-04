/* Page-level settings. Edit this file; no rebuild is required. */
window.GALLERY_CONFIG = {
  title: 'MY GALLERY',
  subtitle: 'Photography portfolio · drag to explore, click to open',
  showSubtitle: false,

  /* Available themes: 'dark' or 'light'. */
  theme: 'light',
};

document.documentElement.dataset.theme =
  window.GALLERY_CONFIG.theme === 'light' ? 'light' : 'dark';
