/**
 * cart-popup.js  ← Main
 */
(() => {
  const esc = (v) =>
    String(v || "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[c]);

  class CartPopup {
    constructor(settings) {
      this.settings = settings;
      this.cart = settings.initialCart || { item_count: 0, items: [], total_price: 0 };

      this.root = null;
      this.lastFocusedElement = null;
      this.isDeleteMode = false;
      this.selectedKeys = new Set();
      this.debounceTimers = new Map();
      this.noteSaveTimer = null;
      this.originalFetch = window.fetch.bind(window);

      try {
        this.appliedDiscount = (sessionStorage.getItem("cart_popup_discount") || "").trim();
      } catch {
        this.appliedDiscount = "";
      }

      this.BREAKPOINTS = { mobile: 767, tablet: 1024 };
    }

    init() {
      this.createInterface();
      this.applyResponsiveLayout();
      this.bindEvents();
      this.bindResizeListener();
      this.replaceThemeCartLinks();
      this.hideThemeCartInterfaces();
      this.watchThemeChanges();
      this.watchCartRequests();
      this.refresh();
    }

    createInterface() {
      const ICONS = window.CartPopupIcons;
      const id = `cart-popup-panel-${this.settings.instanceId}`;
      const t = this.settings.translations;

      this.root = document.createElement("div");
      this.root.className = "cart-popup";
      this.root.style.setProperty("--cart-popup-surface", this.settings.colors.surface);
      this.root.style.setProperty("--cart-popup-accent", this.settings.colors.accent);
      this.root.style.setProperty("--cart-popup-text", this.settings.colors.text);

      this.root.innerHTML = `
        <button class="cart-popup-scrim" data-cart-popup-close type="button" aria-label="${esc(t.close)}"></button>
        <aside class="cart-popup-panel" id="${esc(id)}" aria-hidden="true"
               aria-labelledby="${esc(id)}-title" role="dialog">

          <!-- Header -->
          <header class="cart-popup-header">
            <button class="cart-popup-icon-button" data-cart-popup-close type="button" aria-label="${esc(t.close)}">
              ${ICONS.close}
            </button>
            <h2 class="cart-popup-title" id="${esc(id)}-title">${esc(this.settings.title)}</h2>
            <button class="cart-popup-icon-button cart-popup-icon-button-trash"
                    data-cart-popup-toggle-delete type="button"
                    aria-label="${esc(t.delete)}" title="${esc(t.delete)}">
              ${ICONS.trash}
            </button>
          </header>

          <!-- Bulk Action Bar -->
          <div class="cart-popup-bulk-bar" data-cart-popup-bulk-bar hidden>
            <label class="cart-popup-bulk-select-all">
              <input type="checkbox" class="cart-popup-checkbox" data-cart-popup-select-all />
              <span>${esc(t.selectAll)}</span>
            </label>
            <div class="cart-popup-bulk-actions">
              <button class="cart-popup-bulk-cancel" data-cart-popup-cancel-delete type="button">
                ${esc(t.cancel)}
              </button>
              <button class="cart-popup-bulk-delete-btn" data-cart-popup-execute-delete type="button" disabled>
                ${esc(t.deleteSelected)}
              </button>
            </div>
          </div>

          <!-- Main Content -->
          <div class="cart-popup-content">
            <p class="cart-popup-status" aria-live="polite"></p>
            <div class="cart-popup-items"></div>

            <!-- Empty State -->
            <div class="cart-popup-empty" hidden>
              <div class="cart-popup-empty-icon">${ICONS.cart}</div>
              <h3>${esc(t.emptyHeading)}</h3>
              <p>${esc(t.emptyMessage)}</p>
              <button class="cart-popup-continue" data-cart-popup-close type="button">
                ${esc(t.continueShopping)}
              </button>
            </div>

            <!-- Voucher / Discount -->
            ${this.settings.showVoucher ? `
              <div class="cart-popup-voucher-wrapper" data-cart-popup-voucher-wrapper>
                <div class="cart-popup-voucher-card" data-cart-popup-voucher
                     role="button" tabindex="0"
                     aria-label="${esc(t.haveVoucher || 'Add voucher')}"></div>
                <div class="cart-popup-voucher-form" data-cart-popup-voucher-form hidden>
                  <div class="cart-popup-voucher-input-row">
                    <input type="text" class="cart-popup-voucher-input"
                           data-cart-popup-voucher-input
                           placeholder="${esc(t.enterVoucherCode || 'Enter promo code')}" />
                    <button type="button" class="cart-popup-voucher-apply-btn"
                            data-cart-popup-apply-voucher>
                      ${esc(t.apply || 'Apply')}
                    </button>
                  </div>
                  <div class="cart-popup-voucher-message" data-cart-popup-voucher-msg hidden></div>
                </div>
              </div>
            ` : ""}

            <!-- Order Note -->
            ${this.settings.showOrderNote ? `
              <div class="cart-popup-note-drawer" data-cart-popup-note-wrapper>
                <div class="cart-popup-note-drawer-header" data-cart-popup-note-toggle>
                  <span>${ICONS.note} ${esc(t.orderNote)}</span>
                  <span data-cart-popup-note-arrow>&darr;</span>
                </div>
                <textarea class="cart-popup-note-textarea" id="${esc(id)}-note"
                          placeholder="Write any special instructions for your order..." hidden></textarea>
              </div>
            ` : ""}
          </div>

          <!-- Footer -->
          <footer class="cart-popup-footer" hidden>
            <!-- Subtotal row -->
            <div class="cart-popup-summary-row cart-popup-summary-row-subtotal">
              <span>${esc(t.subtotal || "Subtotal")}</span>
              <span class="cart-popup-subtotal" data-cart-popup-subtotal></span>
            </div>

            <!-- Discount row (only visible when discount applied) -->
            <div class="cart-popup-summary-row cart-popup-summary-row-discount" data-cart-popup-discount-row hidden>
              <span>${esc(t.voucherApplied || "Discount")} (<strong data-cart-popup-discount-code></strong>)</span>
              <span class="cart-popup-discount-val" data-cart-popup-discount-val></span>
            </div>

            <!-- Delivery Fee row -->
            <div class="cart-popup-summary-row cart-popup-summary-row-delivery" data-cart-popup-delivery-row>
              <span>${esc(t.deliveryFee || "Delivery Fee")}</span>
              <span class="cart-popup-delivery-fee-val" data-cart-popup-delivery-val></span>
            </div>

            <!-- Total row -->
            <div class="cart-popup-summary-row cart-popup-summary-row-total">
              <span>${esc(t.total)}</span>
              <span class="cart-popup-total"></span>
            </div>

            <!-- Checkout Button -->
            <a class="cart-popup-checkout" href="${esc(this.settings.checkoutUrl)}">
              <span>${esc(this.settings.checkoutLabel)}</span>
              <span class="cart-popup-checkout-arrow">&rsaquo;</span>
            </a>
          </footer>
        </aside>`;

      document.body.append(this.root);
      this.cacheElements();
    }

    cacheElements() {
      const r = this.root;
      this.itemsElement = r.querySelector(".cart-popup-items");
      this.emptyElement = r.querySelector(".cart-popup-empty");
      this.footerElement = r.querySelector(".cart-popup-footer");
      this.statusElement = r.querySelector(".cart-popup-status");
      this.subtotalElement = r.querySelector("[data-cart-popup-subtotal]");
      this.discountRowElement = r.querySelector("[data-cart-popup-discount-row]");
      this.discountCodeElement = r.querySelector("[data-cart-popup-discount-code]");
      this.discountValElement = r.querySelector("[data-cart-popup-discount-val]");
      this.totalElement = r.querySelector(".cart-popup-total");
      this.deliveryRowElement = r.querySelector("[data-cart-popup-delivery-row]");
      this.deliveryValElement = r.querySelector("[data-cart-popup-delivery-val]");
      this.bulkBarElement = r.querySelector("[data-cart-popup-bulk-bar]");
      this.selectAllCheckbox = r.querySelector("[data-cart-popup-select-all]");
      this.bulkDeleteBtn = r.querySelector("[data-cart-popup-execute-delete]");
      this.noteElement = r.querySelector(".cart-popup-note-textarea");
      this.voucherWrapper = r.querySelector("[data-cart-popup-voucher-wrapper]");
      this.voucherCard = r.querySelector("[data-cart-popup-voucher]");
      this.voucherForm = r.querySelector("[data-cart-popup-voucher-form]");
      this.voucherInput = r.querySelector("[data-cart-popup-voucher-input]");
      this.voucherMsgElement = r.querySelector("[data-cart-popup-voucher-msg]");
      this.checkoutButton = r.querySelector(".cart-popup-checkout");
    }

    bindEvents() {
      this.root.addEventListener("click", (e) => {
        if (e.target.closest("[data-cart-popup-close]")) { this.close(); return; }
        if (e.target.closest("[data-cart-popup-toggle-delete]")) { this.toggleDeleteMode(); return; }
        if (e.target.closest("[data-cart-popup-cancel-delete]")) { this.setDeleteMode(false); return; }
        if (e.target.closest("[data-cart-popup-execute-delete]")) { this.executeBulkDelete(); return; }

        const qBtn = e.target.closest("[data-cart-popup-quantity]");
        if (qBtn) {
          this.handleOptimisticQuantityChange(qBtn.dataset.lineKey, Number(qBtn.dataset.cartPopupQuantity));
          return;
        }

        const removeBtn = e.target.closest("[data-cart-popup-remove]");
        if (removeBtn) {
          this.handleOptimisticQuantityChange(removeBtn.dataset.lineKey, 0);
          return;
        }

        if (e.target.closest("[data-cart-popup-note-toggle]") && this.noteElement) {
          const hidden = this.noteElement.hidden;
          this.noteElement.hidden = !hidden;
          if (!hidden === false) this.noteElement.focus();
          return;
        }

        if (e.target.closest("[data-cart-popup-voucher]") && !e.target.closest("[data-cart-popup-remove-voucher]")) {
          if (!this.appliedDiscount && this.voucherForm) {
            this.voucherForm.hidden = !this.voucherForm.hidden;
            if (!this.voucherForm.hidden && this.voucherInput) this.voucherInput.focus();
          }
          return;
        }

        if (e.target.closest("[data-cart-popup-apply-voucher]") && this.voucherInput) {
          const code = this.voucherInput.value.trim();
          if (code) this.applyDiscount(code);
          return;
        }

        if (e.target.closest("[data-cart-popup-remove-voucher]")) {
          e.stopPropagation();
          this.removeDiscount();
          return;
        }

        if (e.target.closest(".cart-popup-checkout") && this.appliedDiscount) {
          e.preventDefault();
          window.location.href = `/discount/${encodeURIComponent(this.appliedDiscount)}?redirect=${encodeURIComponent(this.settings.checkoutUrl)}`;
        }
      });

      this.root.addEventListener("change", (e) => {
        if (e.target.matches("[data-cart-popup-item-checkbox]")) {
          e.target.checked
            ? this.selectedKeys.add(e.target.dataset.lineKey)
            : this.selectedKeys.delete(e.target.dataset.lineKey);
          this.updateBulkActionState();
          return;
        }
        if (e.target.matches("[data-cart-popup-select-all]")) {
          const checked = e.target.checked;
          this.selectedKeys.clear();
          this.root.querySelectorAll("[data-cart-popup-item-checkbox]").forEach((cb) => {
            cb.checked = checked;
            if (checked) this.selectedKeys.add(cb.dataset.lineKey);
          });
          this.updateBulkActionState();
        }
      });

      document.addEventListener("click", (e) => {
        if (e.target.closest("[data-cart-popup-open]")) { e.preventDefault(); this.open(); return; }
        const link = e.target.closest("a[href]");
        if (link && this.isThemeCartLink(link)) { e.preventDefault(); this.open(); }
      });

      document.addEventListener("submit", (e) => {
        if (!this.isProductForm(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.addProductForm(e.target);
      }, true);

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen()) this.close();
      });

      if (this.noteElement) {
        this.noteElement.addEventListener("input", () => {
          window.clearTimeout(this.noteSaveTimer);
          this.noteSaveTimer = window.setTimeout(() => this.updateNote(), 600);
        });
      }

      if (this.voucherInput) {
        this.voucherInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const code = this.voucherInput.value.trim();
            if (code) this.applyDiscount(code);
          }
        });
      }
    }

    getBreakpoint() {
      const w = window.innerWidth;
      if (w <= this.BREAKPOINTS.mobile) return "mobile";
      if (w <= this.BREAKPOINTS.tablet) return "tablet";
      return "desktop";
    }

    applyResponsiveLayout() {
      if (!this.root) return;
      const bp = this.getBreakpoint();
      const desktopPos = this.settings.position || "right";
      const mobilePref = this.settings.mobilePosition || "bottom";
      const activePos = bp === "mobile"
        ? (mobilePref === "match_desktop" ? desktopPos : "bottom")
        : desktopPos;

      ["right", "left", "top", "bottom"].forEach((p) => this.root.classList.remove(`cart-popup-${p}`));
      this.root.classList.add(`cart-popup-${activePos}`);

      const baseWidth = Number(this.settings.panelWidth) || 420;
      if (bp === "desktop") {
        this.root.style.setProperty("--cart-popup-width", `${baseWidth}px`);
      } else if (bp === "tablet") {
        const tw = Math.max(Math.min(baseWidth, Math.round(window.innerWidth * 0.5)), 340);
        this.root.style.setProperty("--cart-popup-width", `${tw}px`);
      } else {
        this.root.style.removeProperty("--cart-popup-width");
      }
    }

    bindResizeListener() {
      let timer = null;
      window.addEventListener("resize", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (this.isOpen()) this.close();
          this.applyResponsiveLayout();
        }, 150);
      });
    }

    toggleDeleteMode() { this.setDeleteMode(!this.isDeleteMode); }

    setDeleteMode(active) {
      this.isDeleteMode = active;
      this.selectedKeys.clear();
      if (active) {
        this.root.classList.add("cart-popup-selection-mode");
        this.bulkBarElement.hidden = false;
      } else {
        this.root.classList.remove("cart-popup-selection-mode");
        this.bulkBarElement.hidden = true;
      }
      this.root.querySelectorAll("[data-cart-popup-item-checkbox]").forEach((cb) => { cb.checked = false; });
      if (this.selectAllCheckbox) this.selectAllCheckbox.checked = false;
      this.updateBulkActionState();
    }

    updateBulkActionState() {
      const total = Array.isArray(this.cart?.items) ? this.cart.items.length : 0;
      const selected = this.selectedKeys.size;
      if (this.bulkDeleteBtn) {
        this.bulkDeleteBtn.disabled = selected === 0;
        const label = this.settings.translations.deleteSelected || "Delete selected";
        this.bulkDeleteBtn.textContent = selected > 0 ? `${label} (${selected})` : label;
      }
      if (this.selectAllCheckbox) {
        this.selectAllCheckbox.checked = total > 0 && selected === total;
      }
    }

    open() {
      if (this.isOpen()) return;
      this.lastFocusedElement = document.activeElement;
      this.root.classList.add("is-open");
      this.root.querySelector(".cart-popup-panel").setAttribute("aria-hidden", "false");
      document.body.classList.add("cart-popup-lock");
      if (this.dynamicDeliveryFee === undefined && this.cart && this.cart.item_count > 0) {
        this.fetchShippingRates();
      }
    }

    close() {
      if (!this.isOpen()) return;
      this.root.classList.remove("is-open");
      this.root.querySelector(".cart-popup-panel").setAttribute("aria-hidden", "true");
      document.body.classList.remove("cart-popup-lock");
      this.setDeleteMode(false);
      if (this.lastFocusedElement instanceof HTMLElement) {
        this.lastFocusedElement.focus({ preventScroll: true });
      }
    }

    isOpen() { return this.root.classList.contains("is-open"); }

    replaceThemeCartLinks() {
      if (!this.settings.showHeaderIcon) return;
      Array.from(document.querySelectorAll("a[href]"))
        .filter((l) => this.isThemeCartLink(l))
        .forEach((link) => {
          if (link.dataset.cartPopupReplaced === "true") return;
          link.dataset.cartPopupReplaced = "true";
          link.style.setProperty("display", "none", "important");
          link.insertAdjacentElement("afterend", this.createHeaderTrigger());
        });
    }

    createHeaderTrigger() {
      const ICONS = window.CartPopupIcons;
      const btn = document.createElement("button");
      btn.className = "cart-popup-header-trigger";
      btn.dataset.cartPopupOpen = "";
      btn.type = "button";
      btn.setAttribute("aria-label", this.settings.title);
      const icon = this.settings.customIconUrl
        ? `<img class="cart-popup-custom-icon" src="${esc(this.settings.customIconUrl)}" alt="Cart" />`
        : ICONS.cart;
      const count = Number(this.cart?.item_count) || 0;
      const countBadge = `<span class="cart-popup-count" data-cart-popup-count data-count="${count}"${count === 0 ? ' hidden style="display:none!important;"' : ""}>${count > 0 ? count : ""}</span>`;
      btn.innerHTML = `${icon}${countBadge}`;
      return btn;
    }

    hideThemeCartInterfaces() {
      const sel = ["cart-drawer", "cart-notification", ".cart-drawer", ".cart-notification",
        ".drawer--cart", "#CartDrawer", "#CartNotification"];
      document.querySelectorAll(sel.join(",")).forEach((el) => {
        if (!this.root.contains(el)) {
          el.setAttribute("aria-hidden", "true");
          el.style.setProperty("display", "none", "important");
        }
      });
    }

    watchThemeChanges() {
      new MutationObserver(() => {
        this.replaceThemeCartLinks();
        this.hideThemeCartInterfaces();
      }).observe(document.body, { childList: true, subtree: true });
    }

    isThemeCartLink(link) {
      if (this.root && this.root.contains(link)) return false;
      try {
        const u = new URL(link.href, window.location.origin);
        const c = new URL(this.settings.cartUrl, window.location.origin);
        return u.pathname === c.pathname;
      } catch { return false; }
    }

    isProductForm(form) {
      if (!(form instanceof HTMLFormElement)) return false;
      const action = form.getAttribute("action") || "";
      return action.includes("/cart/add") ||
        Boolean(form.querySelector("[name='id']") && form.querySelector("[type='submit'],[name='add']"));
    }
  }

  Object.assign(CartPopup.prototype, window.CartPopupApi);
  Object.assign(CartPopup.prototype, window.CartPopupUi);

  const start = () => {
    document.querySelectorAll("script[id^='cart-popup-settings-']").forEach((el) => {
      try {
        new CartPopup(JSON.parse(el.textContent)).init();
      } catch (err) {
        console.error("[CartPopup] Init Error:", err);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();