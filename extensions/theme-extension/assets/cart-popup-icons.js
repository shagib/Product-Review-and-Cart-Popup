/**
 * cart-popup-icons.js
 * SVG icon definitions used across the Cart Popup drawer UI.
 * Loaded once and shared via window.CartPopupIcons.
 */
(() => {
  window.CartPopupIcons = {
    cart: `<svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22"><path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" /><circle cx="10" cy="20" fill="currentColor" r="1.2" /><circle cx="18" cy="20" fill="currentColor" r="1.2" /></svg>`,
    close: `<svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-linecap="round" stroke-width="2" /></svg>`,
    trash: `<svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" /></svg>`,
    voucher: `<svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18"><rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M2 12h3M19 12h3M12 6v12" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2"/></svg>`,
    note: `<svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };
})();
