/**
 * ============================================================================
 * Shopify Cart Popup Drawer Engine
 * 
 * Features:
 * - Optimistic UI Updates: Instant quantity updates (+ / -) with zero UI lag.
 * - Bulk Deletion Mode: Header trash icon activates checkboxes for mass removal.
 * - Dynamic Position: Supports 'right', 'left', 'top', and 'bottom' drawer views.
 * - Custom Icon Support: Displays user-uploaded image icon or fallback SVG.
 * - Theme Integration: Intercepts product forms and global fetch /cart mutations.
 * ============================================================================
 */

(() => {
  // SVG Icons used across the drawer UI
  const ICONS = {
    cart: `
      <svg aria-hidden="true" fill="none" height="22" viewBox="0 0 24 24" width="22">
        <path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
        <circle cx="10" cy="20" fill="currentColor" r="1.2" />
        <circle cx="18" cy="20" fill="currentColor" r="1.2" />
      </svg>`,
    close: `
      <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
        <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-linecap="round" stroke-width="2" />
      </svg>`,
    trash: `
      <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" />
      </svg>`,
    voucher: `
      <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
        <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/>
        <path d="M2 12h3M19 12h3M12 6v12" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2"/>
      </svg>`,
    note: `
      <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`
  };

  /**
   * Helper function to safely escape HTML strings to prevent XSS vulnerabilities
   */
  const escapeHtml = (value) =>
    String(value || "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      "\"": "&quot;",
    })[char]);

  class CartPopup {
    /**
     * @param {Object} settings - Configuration injected from cart-popup.liquid schema
     */
    constructor(settings) {
      this.settings = settings;
      this.cart = { item_count: 0, items: [], total_price: 0 };
      this.root = null;
      this.lastFocusedElement = null;

      // Selection & Bulk Deletion State
      this.isDeleteMode = false;
      this.selectedKeys = new Set();

      // Debounce Timers for fast snappiness without overwhelming Shopify APIs
      this.debounceTimers = new Map();
      this.noteSaveTimer = null;
      this.originalFetch = window.fetch.bind(window);
    }

    /**
     * Entry point: Builds interface, binds events, and synchronizes initial cart state.
     */
    init() {
      this.createInterface();
      this.bindEvents();
      this.replaceThemeCartLinks();
      this.hideThemeCartInterfaces();
      this.watchThemeChanges();
      this.watchCartRequests();
      this.refresh();
    }

    /**
     * Creates and mounts the DOM elements for the drawer according to settings.
     */
    createInterface() {
      const popupId = `cart-popup-panel-${this.settings.instanceId}`;
      const translation = this.settings.translations;

      this.root = document.createElement("div");
      this.root.className = `cart-popup cart-popup--${this.settings.position || "right"}`;
      this.root.style.setProperty("--cart-popup-surface", this.settings.colors.surface);
      this.root.style.setProperty("--cart-popup-accent", this.settings.colors.accent);
      this.root.style.setProperty("--cart-popup-text", this.settings.colors.text);
      this.root.style.setProperty("--cart-popup-width", `${this.settings.panelWidth || 420}px`);

      this.root.innerHTML = `
        <button class="cart-popup__scrim" data-cart-popup-close type="button" aria-label="${escapeHtml(translation.close)}"></button>
        <aside class="cart-popup__panel" id="${escapeHtml(popupId)}" aria-hidden="true" aria-labelledby="${escapeHtml(popupId)}-title" role="dialog">
          
          <!-- 1. Header: 3-column layout (Close button, Center Title, Trash icon) -->
          <header class="cart-popup__header">
            <button class="cart-popup__icon-button" data-cart-popup-close type="button" aria-label="${escapeHtml(translation.close)}">
              ${ICONS.close}
            </button>
            <h2 class="cart-popup__title" id="${escapeHtml(popupId)}-title">${escapeHtml(this.settings.title)}</h2>
            <button class="cart-popup__icon-button cart-popup__icon-button--trash" data-cart-popup-toggle-delete type="button" aria-label="${escapeHtml(translation.delete)}" title="${escapeHtml(translation.delete)}">
              ${ICONS.trash}
            </button>
          </header>

          <!-- 2. Bulk Action Bar (Revealed when Trash button is clicked) -->
          <div class="cart-popup__bulk-bar" data-cart-popup-bulk-bar hidden>
            <label class="cart-popup__bulk-select-all">
              <input type="checkbox" class="cart-popup__checkbox" data-cart-popup-select-all />
              <span>${escapeHtml(translation.selectAll)}</span>
            </label>
            <div class="cart-popup__bulk-actions">
              <button class="cart-popup__bulk-cancel" data-cart-popup-cancel-delete type="button">
                ${escapeHtml(translation.cancel)}
              </button>
              <button class="cart-popup__bulk-delete-btn" data-cart-popup-execute-delete type="button" disabled>
                ${escapeHtml(translation.deleteSelected)}
              </button>
            </div>
          </div>

          <!-- 3. Main Cart Content Area -->
          <div class="cart-popup__content">
            <p class="cart-popup__status" aria-live="polite"></p>
            
            <!-- Items Container -->
            <div class="cart-popup__items"></div>

            <!-- Empty State (Guaranteed hidden when items are present) -->
            <div class="cart-popup__empty" hidden>
              <div class="cart-popup__empty-icon">${ICONS.cart}</div>
              <h3>${escapeHtml(translation.emptyHeading)}</h3>
              <p>${escapeHtml(translation.emptyMessage)}</p>
              <button class="cart-popup__continue" data-cart-popup-close type="button">${escapeHtml(translation.continueShopping)}</button>
            </div>

            <!-- Optional Voucher Banner (Matching mockup) -->
            ${this.settings.showVoucher ? `
              <div class="cart-popup__voucher-card" data-cart-popup-voucher>
                <div class="cart-popup__voucher-left">
                  ${ICONS.voucher}
                  <span>${escapeHtml(translation.voucherApplied)}</span>
                </div>
                <span class="cart-popup__voucher-badge">${escapeHtml(this.settings.voucherCode || "WELCOME")} &rsaquo;</span>
              </div>
            ` : ""}

            <!-- Collapsible Order Note / Special Request Area -->
            ${this.settings.showOrderNote ? `
              <div class="cart-popup__note-drawer" data-cart-popup-note-wrapper>
                <div class="cart-popup__note-drawer-header" data-cart-popup-note-toggle>
                  <span>${ICONS.note} ${escapeHtml(translation.orderNote)}</span>
                  <span data-cart-popup-note-arrow>&darr;</span>
                </div>
                <textarea class="cart-popup__note-textarea" id="${escapeHtml(popupId)}-note" placeholder="Write any special instructions for your order..." hidden></textarea>
              </div>
            ` : ""}
          </div>

          <!-- 4. Footer with Summary and Large Checkout Button -->
          <footer class="cart-popup__footer" hidden>
            <!-- Free Delivery Progress Bar -->
            <div class="cart-popup__delivery" hidden>
              <p class="cart-popup__delivery-message"></p>
              <div class="cart-popup__progress" aria-hidden="true">
                <div class="cart-popup__progress-bar"></div>
              </div>
            </div>

            <!-- Delivery Fee Row (from mockup) -->
            <div class="cart-popup__summary-row cart-popup__summary-row--delivery">
              <span>${escapeHtml(translation.deliveryFee)}</span>
              <span class="cart-popup__delivery-fee-val">${escapeHtml(translation.free)}</span>
            </div>

            <!-- Total Price Row -->
            <div class="cart-popup__summary-row cart-popup__summary-row--total">
              <span>${escapeHtml(translation.total)}</span>
              <span class="cart-popup__total"></span>
            </div>

            <!-- Pill Red Checkout Button with Arrow Indicator -->
            <a class="cart-popup__checkout" href="${escapeHtml(this.settings.checkoutUrl)}">
              <span>${escapeHtml(this.settings.checkoutLabel)}</span>
              <span class="cart-popup__checkout-arrow">&rsaquo;</span>
            </a>
          </footer>
        </aside>`;

      document.body.append(this.root);

      // Cache key element references for high performance
      this.itemsElement = this.root.querySelector(".cart-popup__items");
      this.emptyElement = this.root.querySelector(".cart-popup__empty");
      this.footerElement = this.root.querySelector(".cart-popup__footer");
      this.statusElement = this.root.querySelector(".cart-popup__status");
      this.totalElement = this.root.querySelector(".cart-popup__total");
      this.bulkBarElement = this.root.querySelector("[data-cart-popup-bulk-bar]");
      this.selectAllCheckbox = this.root.querySelector("[data-cart-popup-select-all]");
      this.bulkDeleteBtn = this.root.querySelector("[data-cart-popup-execute-delete]");
      this.deliveryElement = this.root.querySelector(".cart-popup__delivery");
      this.deliveryMessageElement = this.root.querySelector(".cart-popup__delivery-message");
      this.deliveryBarElement = this.root.querySelector(".cart-popup__progress-bar");
      this.noteElement = this.root.querySelector(".cart-popup__note-textarea");
      this.noteToggle = this.root.querySelector("[data-cart-popup-note-toggle]");
      this.voucherCard = this.root.querySelector("[data-cart-popup-voucher]");
    }

    /**
     * Binds user interactions and listeners
     */
    bindEvents() {
      // Delegated clicks inside popup
      this.root.addEventListener("click", (event) => {
        // Close button or backdrop scrim
        if (event.target.closest("[data-cart-popup-close]")) {
          this.close();
          return;
        }

        // Toggle Bulk Delete Mode
        if (event.target.closest("[data-cart-popup-toggle-delete]")) {
          this.toggleDeleteMode();
          return;
        }

        // Cancel Bulk Delete Mode
        if (event.target.closest("[data-cart-popup-cancel-delete]")) {
          this.setDeleteMode(false);
          return;
        }

        // Execute Bulk Delete
        if (event.target.closest("[data-cart-popup-execute-delete]")) {
          this.executeBulkDelete();
          return;
        }

        // Quantity Increase / Decrease buttons (Optimistic UI)
        const quantityButton = event.target.closest("[data-cart-popup-quantity]");
        if (quantityButton) {
          const lineKey = quantityButton.dataset.lineKey;
          const targetQty = Number(quantityButton.dataset.cartPopupQuantity);
          this.handleOptimisticQuantityChange(lineKey, targetQty);
          return;
        }

        // Single Remove button
        const removeButton = event.target.closest("[data-cart-popup-remove]");
        if (removeButton) {
          const lineKey = removeButton.dataset.lineKey;
          this.handleOptimisticQuantityChange(lineKey, 0);
          return;
        }

        // Toggle special note accordion
        if (event.target.closest("[data-cart-popup-note-toggle]") && this.noteElement) {
          const isHidden = this.noteElement.hidden;
          this.noteElement.hidden = !isHidden;
          if (!this.noteElement.hidden) this.noteElement.focus();
        }
      });

      // Line item checkbox toggle in delete mode
      this.root.addEventListener("change", (event) => {
        if (event.target.matches("[data-cart-popup-item-checkbox]")) {
          const lineKey = event.target.dataset.lineKey;
          if (event.target.checked) {
            this.selectedKeys.add(lineKey);
          } else {
            this.selectedKeys.delete(lineKey);
          }
          this.updateBulkActionState();
          return;
        }

        if (event.target.matches("[data-cart-popup-select-all]")) {
          const isChecked = event.target.checked;
          const itemCheckboxes = this.root.querySelectorAll("[data-cart-popup-item-checkbox]");
          this.selectedKeys.clear();
          itemCheckboxes.forEach((cb) => {
            cb.checked = isChecked;
            if (isChecked) this.selectedKeys.add(cb.dataset.lineKey);
          });
          this.updateBulkActionState();
        }
      });

      // Global click handler to intercept theme cart clicks
      document.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-cart-popup-open]");
        if (trigger) {
          event.preventDefault();
          this.open();
          return;
        }

        const cartLink = event.target.closest("a[href]");
        if (cartLink && this.isThemeCartLink(cartLink)) {
          event.preventDefault();
          this.open();
        }
      });

      // Intercept standard Add-to-cart form submissions
      document.addEventListener("submit", (event) => {
        const form = event.target;
        if (!this.isProductForm(form)) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        this.addProductForm(form);
      }, true);

      // Keyboard Accessibility: Escape key closes drawer
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.isOpen()) this.close();
      });

      // Debounced Order Note Auto-saving
      if (this.noteElement) {
        this.noteElement.addEventListener("input", () => {
          window.clearTimeout(this.noteSaveTimer);
          this.noteSaveTimer = window.setTimeout(() => this.updateNote(), 600);
        });
      }
    }

    /**
     * ========================================================================
     * OPTIMISTIC UI ENGINE (Instant Quantity Updates)
     * ========================================================================
     * Updates DOM quantity immediately when user clicks '+' or '-', recalculates
     * totals on the fly, and debounces the network request to Shopify.
     */
    handleOptimisticQuantityChange(lineKey, newQuantity) {
      const item = this.cart.items.find((i) => i.key === lineKey);
      if (!item) return;

      const lineElement = this.root.querySelector(`[data-line-item-key="${CSS.escape(lineKey)}"]`);
      if (!lineElement) return;

      if (newQuantity <= 0) {
        // Optimistically hide line immediately
        lineElement.style.opacity = "0.4";
      } else {
        // Optimistically update quantity text and buttons
        const qtyValue = lineElement.querySelector(".cart-popup__quantity-value");
        if (qtyValue) qtyValue.textContent = newQuantity;

        const minusBtn = lineElement.querySelector("[data-cart-popup-quantity]:first-child");
        const plusBtn = lineElement.querySelector("[data-cart-popup-quantity]:last-child");
        if (minusBtn) minusBtn.dataset.cartPopupQuantity = newQuantity - 1;
        if (plusBtn) plusBtn.dataset.cartPopupQuantity = newQuantity + 1;

        // Optimistically update price
        const priceElement = lineElement.querySelector(".cart-popup__price");
        const unitPrice = item.final_price || (item.final_line_price / item.quantity);
        if (priceElement) priceElement.textContent = this.money(unitPrice * newQuantity);
      }

      // Optimistically update subtotal & item count
      const qtyDifference = newQuantity - item.quantity;
      const unitPrice = item.final_price || (item.final_line_price / item.quantity);
      this.cart.total_price += qtyDifference * unitPrice;
      this.cart.item_count += qtyDifference;
      item.quantity = newQuantity;

      if (this.totalElement) this.totalElement.textContent = this.money(this.cart.total_price);
      this.updateHeaderCount();
      this.renderDeliveryProgress();

      // Debounce server call for 250ms so rapid clicking doesn't lag or spam requests
      if (this.debounceTimers.has(lineKey)) {
        window.clearTimeout(this.debounceTimers.get(lineKey));
      }

      const timer = window.setTimeout(async () => {
        this.debounceTimers.delete(lineKey);
        await this.syncQuantityWithServer(lineKey, newQuantity);
      }, 250);

      this.debounceTimers.set(lineKey, timer);
    }

    /**
     * Sends change request to Shopify Cart API and synchronizes response.
     */
    async syncQuantityWithServer(lineKey, quantity) {
      try {
        const response = await this.originalFetch(this.getCartEndpoint("change"), {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ id: lineKey, quantity }),
        });

        if (!response.ok) throw new Error("Server rejected update");

        this.cart = await response.json();
        this.render();
      } catch (error) {
        console.error("Failed to sync quantity:", error);
        // Fallback: reload exact cart on error
        this.refresh();
      }
    }

    /**
     * ========================================================================
     * BULK SELECTION & DELETION SYSTEM
     * ========================================================================
     */
    toggleDeleteMode() {
      this.setDeleteMode(!this.isDeleteMode);
    }

    setDeleteMode(active) {
      this.isDeleteMode = active;
      this.selectedKeys.clear();

      if (active) {
        this.root.classList.add("cart-popup--selection-mode");
        this.bulkBarElement.hidden = false;
      } else {
        this.root.classList.remove("cart-popup--selection-mode");
        this.bulkBarElement.hidden = true;
      }

      // Uncheck all item checkboxes
      this.root.querySelectorAll("[data-cart-popup-item-checkbox]").forEach((cb) => {
        cb.checked = false;
      });
      if (this.selectAllCheckbox) this.selectAllCheckbox.checked = false;

      this.updateBulkActionState();
    }

    updateBulkActionState() {
      const totalItems = this.cart.items.length;
      const selectedCount = this.selectedKeys.size;

      if (this.bulkDeleteBtn) {
        this.bulkDeleteBtn.disabled = selectedCount === 0;
        const deleteLabel = this.settings.translations.deleteSelected || "Delete selected";
        this.bulkDeleteBtn.textContent = selectedCount > 0 ? `${deleteLabel} (${selectedCount})` : deleteLabel;
      }

      if (this.selectAllCheckbox) {
        this.selectAllCheckbox.checked = totalItems > 0 && selectedCount === totalItems;
      }
    }

    async executeBulkDelete() {
      if (this.selectedKeys.size === 0) return;

      const updates = {};
      this.selectedKeys.forEach((key) => {
        updates[key] = 0;
      });

      // Optimistically hide selected lines
      this.selectedKeys.forEach((key) => {
        const line = this.root.querySelector(`[data-line-item-key="${CSS.escape(key)}"]`);
        if (line) line.style.opacity = "0.2";
      });

      try {
        const response = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ updates }),
        });

        if (!response.ok) throw new Error("Bulk delete failed");

        this.cart = await response.json();
        this.setDeleteMode(false);
        this.render();
      } catch (error) {
        console.error("Bulk delete error:", error);
        this.refresh();
      }
    }

    /**
     * ========================================================================
     * CART RENDERING & UI SYNC
     * ========================================================================
     */
    render() {
      const hasItems = this.cart && this.cart.item_count > 0;

      // Crucial Fix: Strictly toggle empty state vs items
      if (hasItems) {
        this.itemsElement.innerHTML = this.cart.items.map((item) => this.renderLineItem(item)).join("");
        this.emptyElement.hidden = true;
        this.emptyElement.style.display = "none";
        this.footerElement.hidden = false;
        this.footerElement.style.display = "block";
        if (this.voucherCard) this.voucherCard.hidden = false;
      } else {
        this.itemsElement.innerHTML = "";
        this.emptyElement.hidden = false;
        this.emptyElement.style.display = "flex";
        this.footerElement.hidden = true;
        this.footerElement.style.display = "none";
        if (this.voucherCard) this.voucherCard.hidden = true;
        this.setDeleteMode(false);
      }

      // Update total price
      if (this.totalElement) {
        this.totalElement.textContent = this.money(this.cart.total_price);
      }

      // Update note value
      if (this.noteElement && document.activeElement !== this.noteElement) {
        this.noteElement.value = this.cart.note || "";
      }

      this.renderDeliveryProgress();
      this.updateHeaderCount();
      this.updateBulkActionState();
    }

    /**
     * Renders a single line item card matching the provided mockup
     */
    renderLineItem(item) {
      const translation = this.settings.translations;
      const productTitle = escapeHtml(item.product_title || item.title);
      const variantTitle = item.variant_title && item.variant_title !== "Default Title"
        ? `<p class="cart-popup__variant">${escapeHtml(item.variant_title)}</p>`
        : "";

      const image = item.image
        ? `<img class="cart-popup__image" src="${escapeHtml(item.image)}" alt="${productTitle}" loading="lazy" width="84" height="84" />`
        : `<div class="cart-popup__image" aria-hidden="true"></div>`;

      const isChecked = this.selectedKeys.has(item.key) ? "checked" : "";

      return `
        <article class="cart-popup__line" data-line-item-key="${escapeHtml(item.key)}">
          <!-- Selection Checkbox (Visible in Delete Mode) -->
          <div class="cart-popup__line-checkbox">
            <input type="checkbox" class="cart-popup__checkbox" data-cart-popup-item-checkbox data-line-key="${escapeHtml(item.key)}" ${isChecked} />
          </div>

          <!-- Product Thumbnail -->
          <a class="cart-popup__image-link" href="${escapeHtml(item.url)}" aria-label="${productTitle}">
            ${image}
          </a>

          <!-- Details -->
          <div class="cart-popup__line-details">
            <div class="cart-popup__line-header">
              <a class="cart-popup__product-link" href="${escapeHtml(item.url)}">${productTitle}</a>
            </div>
            ${variantTitle}

            <!-- Special Request Prompt (Matching design) -->
            ${this.settings.showOrderNote ? `
              <button class="cart-popup__special-request-btn" data-cart-popup-note-toggle type="button">
                ${ICONS.note} <span>${escapeHtml(translation.addSpecialRequest || "Add Special Request")}</span>
              </button>
            ` : ""}

            <!-- Price and Quantity Selector -->
            <div class="cart-popup__line-footer">
              <span class="cart-popup__price">${this.money(item.final_line_price)}</span>
              
              <div class="cart-popup__quantity" aria-label="${escapeHtml(translation.quantity)}">
                <button class="cart-popup__quantity-button" data-cart-popup-quantity="${item.quantity - 1}" data-line-key="${escapeHtml(item.key)}" type="button" aria-label="${escapeHtml(translation.decreaseQuantity)}">&minus;</button>
                <span class="cart-popup__quantity-value">${item.quantity}</span>
                <button class="cart-popup__quantity-button" data-cart-popup-quantity="${item.quantity + 1}" data-line-key="${escapeHtml(item.key)}" type="button" aria-label="${escapeHtml(translation.increaseQuantity)}">&plus;</button>
              </div>
            </div>
          </div>
        </article>`;
    }

    /**
     * Calculates and renders the Free Delivery Progress Bar
     */
    renderDeliveryProgress() {
      const threshold = Number(this.settings.freeDeliveryThreshold);
      if (!threshold || threshold < 1 || !this.deliveryElement) {
        if (this.deliveryElement) this.deliveryElement.hidden = true;
        return;
      }

      const amountRemaining = Math.max(threshold - this.cart.total_price, 0);
      const progress = Math.min((this.cart.total_price / threshold) * 100, 100);

      this.deliveryElement.hidden = false;
      this.deliveryBarElement.style.width = `${progress}%`;
      this.deliveryMessageElement.textContent = amountRemaining > 0
        ? this.settings.translations.freeDeliveryRemaining.replace("{{ amount }}", this.money(amountRemaining))
        : this.settings.translations.freeDeliveryUnlocked;
    }

    /**
     * Replaces theme cart links with popup trigger containing custom/default icon
     */
    replaceThemeCartLinks() {
      if (!this.settings.showHeaderIcon) return;

      const themeCartLinks = Array.from(document.querySelectorAll("a[href]")).filter((link) => this.isThemeCartLink(link));

      themeCartLinks.forEach((link) => {
        if (link.dataset.cartPopupReplaced === "true") return;

        link.dataset.cartPopupReplaced = "true";
        link.style.setProperty("display", "none", "important");
        link.insertAdjacentElement("afterend", this.createHeaderTrigger());
      });
    }

    /**
     * Generates header trigger button with uploaded custom icon or SVG fallback
     */
    createHeaderTrigger() {
      const trigger = document.createElement("button");
      trigger.className = "cart-popup__header-trigger";
      trigger.dataset.cartPopupOpen = "";
      trigger.type = "button";
      trigger.setAttribute("aria-label", this.settings.title);

      const iconMarkup = this.settings.customIconUrl
        ? `<img class="cart-popup__custom-icon" src="${escapeHtml(this.settings.customIconUrl)}" alt="Cart" />`
        : ICONS.cart;

      trigger.innerHTML = `${iconMarkup}<span class="cart-popup__count" data-cart-popup-count>${this.cart.item_count}</span>`;
      return trigger;
    }

    /**
     * Hides conflicting theme drawers (such as Dawn's cart-drawer)
     */
    hideThemeCartInterfaces() {
      const selectors = [
        "cart-drawer",
        "cart-notification",
        ".cart-drawer",
        ".cart-notification",
        ".drawer--cart",
        "#CartDrawer",
        "#CartNotification",
      ];

      document.querySelectorAll(selectors.join(",")).forEach((el) => {
        if (!this.root.contains(el)) {
          el.setAttribute("aria-hidden", "true");
          el.style.setProperty("display", "none", "important");
        }
      });
    }

    watchThemeChanges() {
      const observer = new MutationObserver(() => {
        this.replaceThemeCartLinks();
        this.hideThemeCartInterfaces();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * Intercepts window.fetch for /cart/add, /cart/change, etc., to auto-update
     */
    watchCartRequests() {
      window.fetch = async (...args) => {
        const response = await this.originalFetch(...args);
        const url = this.getRequestUrl(args[0]);

        if (this.isCartMutation(url)) {
          window.setTimeout(() => {
            this.refresh();
            if (url.includes("/cart/add") && this.settings.openAfterAdd) {
              this.open();
            }
          }, 50);
        }

        return response;
      };
    }

    isCartMutation(url) {
      return /\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/.test(url);
    }

    getRequestUrl(req) {
      if (req instanceof Request) return req.url;
      return String(req || "");
    }

    getCartEndpoint(action) {
      return `${this.settings.cartUrl.replace(/\/$/, "")}/${action}.js`;
    }

    isThemeCartLink(link) {
      if (this.root && this.root.contains(link)) return false;
      try {
        const url = new URL(link.href, window.location.origin);
        const cartUrl = new URL(this.settings.cartUrl, window.location.origin);
        return url.pathname === cartUrl.pathname;
      } catch {
        return false;
      }
    }

    isProductForm(form) {
      if (!(form instanceof HTMLFormElement)) return false;
      const action = form.getAttribute("action") || "";
      return action.includes("/cart/add") || Boolean(form.querySelector("[name='id']") && form.querySelector("[type='submit'], [name='add']"));
    }

    async addProductForm(form) {
      this.setStatus("");
      try {
        const response = await this.originalFetch(this.getCartEndpoint("add"), {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        });

        if (!response.ok) throw new Error("Could not add product");

        await this.refresh();
        if (this.settings.openAfterAdd) this.open();
      } catch (err) {
        console.error(err);
        this.setStatus(this.settings.translations.cartError);
      }
    }

    async refresh() {
      try {
        const res = await this.originalFetch(`${this.settings.cartUrl.replace(/\/$/, "")}.js`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) throw new Error("Failed to fetch cart");
        this.cart = await res.json();
        this.render();
      } catch (err) {
        console.error(err);
      }
    }

    async updateNote() {
      if (!this.noteElement) return;
      try {
        await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ note: this.noteElement.value }),
        });
      } catch (err) {
        console.error("Failed to update note:", err);
      }
    }

    updateHeaderCount() {
      document.querySelectorAll("[data-cart-popup-count]").forEach((count) => {
        count.textContent = this.cart.item_count;
      });
    }

    /**
     * Formats amounts with the store currency symbol
     */
    money(cents) {
      const locale = document.documentElement.lang || undefined;
      const currency = this.cart.currency || window.Shopify?.currency?.active || "USD";
      try {
        return new Intl.NumberFormat(locale, { currency, style: "currency" }).format(Number(cents || 0) / 100);
      } catch {
        return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
      }
    }

    setStatus(msg) {
      if (this.statusElement) this.statusElement.textContent = msg;
    }

    open() {
      if (this.isOpen()) return;
      this.lastFocusedElement = document.activeElement;
      this.root.classList.add("is-open");
      this.root.querySelector(".cart-popup__panel").setAttribute("aria-hidden", "false");
      document.body.classList.add("cart-popup-lock");
    }

    close() {
      if (!this.isOpen()) return;
      this.root.classList.remove("is-open");
      this.root.querySelector(".cart-popup__panel").setAttribute("aria-hidden", "true");
      document.body.classList.remove("cart-popup-lock");
      this.setDeleteMode(false);
      if (this.lastFocusedElement instanceof HTMLElement) {
        this.lastFocusedElement.focus({ preventScroll: true });
      }
    }

    isOpen() {
      return this.root.classList.contains("is-open");
    }
  }

  // Self-bootstrapping when DOM is ready
  const start = () => {
    document.querySelectorAll("script[id^='cart-popup-settings-']").forEach((el) => {
      try {
        new CartPopup(JSON.parse(el.textContent)).init();
      } catch (err) {
        console.error("CartPopup Init Error:", err);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
