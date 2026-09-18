/**
 * cart-popup-ui.js
 * Handles all DOM rendering, HTML generation and UI state for the Cart Popup drawer.
 */
(() => {
  const esc = (v) =>
    String(v || "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[c]);

  window.CartPopupUi = {
    money(cents) {
      const locale = document.documentElement.lang || undefined;
      const currency = this.cart?.currency || window.Shopify?.currency?.active || "USD";
      try {
        return new Intl.NumberFormat(locale, { currency, style: "currency" }).format(
          Number(cents || 0) / 100
        );
      } catch {
        return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
      }
    },

    _isGiftLine(item) {
      if (item && item.properties && typeof item.properties === "object") {
        const hasGiftProp = Object.keys(item.properties).some((k) =>
          /^_.*gift.*$/i.test(k)
        );
        if (hasGiftProp) return true;
      }

      const orig = Number(item?.original_line_price);
      const final = Number(item?.final_line_price);
      const hasAllocation =
        Array.isArray(item?.line_level_discount_allocations) &&
        item.line_level_discount_allocations.length > 0;
      return orig > 0 && final === 0 && hasAllocation;
    },

    _getActiveDiscounts() {
      if (typeof this._extractDiscountApplications === "function") {
        return this._extractDiscountApplications(this.cart);
      }
      return Array.isArray(this.activeDiscounts) ? this.activeDiscounts : [];
    },

    getDiscountDetails(totalDiscount) {
      if (!totalDiscount || totalDiscount <= 0) return null;

      const discounts = this._getActiveDiscounts().filter((d) => d.targetType !== "shipping_line");

      let grossSubtotal = 0;
      if (this.cart && Array.isArray(this.cart.items)) {
        grossSubtotal = this.cart.items.reduce((sum, item) => {
          const qty = Number(item.quantity) || 1;
          const orig = Number(item.original_line_price ?? (item.original_price * qty)) || 0;
          return sum + orig;
        }, 0);
      }

      if (grossSubtotal <= 0) {
        grossSubtotal = Number(this.cart?.original_total_price) || (Number(this.cart?.total_price) + totalDiscount);
      }

      const overallPercentage = grossSubtotal > 0 ? Math.round((totalDiscount / grossSubtotal) * 100) : 0;

      const codeEntry = discounts.find((d) => d.type === "discount_code");
      const autoEntries = discounts.filter((d) => d.type !== "discount_code");

      const labelParts = [];
      if (codeEntry) labelParts.push(codeEntry.title);
      autoEntries.forEach((d) => {
        if (!labelParts.includes(d.title)) labelParts.push(d.title);
      });

      let percentageLabel = null;
      if (discounts.length === 1 && discounts[0].valueType === "percentage" && discounts[0].value != null) {
        const v = Math.round(Math.abs(discounts[0].value));
        percentageLabel = v > 0 ? `${v}% OFF` : null;
      } else if (overallPercentage > 0) {
        percentageLabel = `${overallPercentage}% OFF`;
      }

      return {
        code: labelParts.length ? labelParts.join(" + ") : (this.appliedDiscount || "DISCOUNT"),
        amountFormatted: this.money(totalDiscount),
        percentage: percentageLabel,
        hasRemovableCode: Boolean(codeEntry),
      };
    },

    getCartSubtotal() {
      if (this.cart && Array.isArray(this.cart.items) && this.cart.items.length > 0) {
        const computed = this.cart.items.reduce((sum, item) => {
          const qty = Number(item.quantity) || 1;
          const linePrice = Number(item.final_line_price ?? item.line_price ?? (item.price * qty)) || 0;
          return sum + linePrice;
        }, 0);
        return computed > 0 ? computed : (Number(this.cart.total_price) || 0);
      }
      return Number(this.cart?.total_price) || 0;
    },

    render() {
      const hasItems =
        this.cart &&
        Array.isArray(this.cart.items) &&
        this.cart.items.length > 0 &&
        this.cart.item_count > 0;

      if (hasItems) {
        this.itemsElement.innerHTML = this.cart.items
          .map((item) => this.renderLineItem(item))
          .join("");
        this.emptyElement.hidden = true;
        this.emptyElement.style.display = "none";
        this.footerElement.hidden = false;
        this.footerElement.style.display = "block";
        if (this.voucherWrapper) this.voucherWrapper.hidden = false;
      } else {
        this.itemsElement.innerHTML = "";
        this.emptyElement.hidden = false;
        this.emptyElement.style.display = "flex";
        this.footerElement.hidden = true;
        this.footerElement.style.display = "none";
        if (this.voucherWrapper) this.voucherWrapper.hidden = true;
        this.setDeleteMode(false);
      }

      if (!this.appliedDiscount) {
        try {
          this.appliedDiscount = sessionStorage.getItem("cart_popup_discount") || "";
        } catch (e) { }
      }

      this.renderTotals();

      if (this.noteElement && document.activeElement !== this.noteElement) {
        this.noteElement.value = this.cart.note || "";
      }

      this.renderVoucher();
      this.updateCheckoutUrl();
      this.updateHeaderCount();
      this.updateBulkActionState();
    },

    renderTotals() {
      this.activeDiscounts = this._getActiveDiscounts();

      let originalSubtotal = 0;
      let lineDiscounts = 0;

      if (this.cart && Array.isArray(this.cart.items)) {
        this.cart.items.forEach((item) => {
          const qty = Number(item.quantity) || 1;
          const orig = Number(item.original_line_price ?? (item.original_price * qty)) || 0;
          const final = Number(item.final_line_price ?? item.line_price ?? (item.price * qty)) || 0;
          originalSubtotal += orig;
          if (orig > final) {
            lineDiscounts += (orig - final);
          }
        });
      }

      if (originalSubtotal <= 0) {
        originalSubtotal = Number(this.cart?.original_total_price) || Number(this.cart?.total_price) || 0;
      }

      const totalDiscount = Number(this.cart?.total_discount) || lineDiscounts;

      const discountedSubtotal = Math.max(0, originalSubtotal - totalDiscount);
      if (this.cart) {
        this.cart.total_price = discountedSubtotal;
      }

      if (this.subtotalElement) {
        this.subtotalElement.textContent = this.money(originalSubtotal);
      }

      if (this.discountRowElement) {
        const discountInfo = this.getDiscountDetails(totalDiscount);

        if (discountInfo) {
          this.discountRowElement.hidden = false;
          this.discountRowElement.style.display = "flex";

          if (this.discountCodeElement) {
            const badgeText = discountInfo.percentage ? `<small class="cart-popup-discount-pct">(${discountInfo.percentage})</small>` : "";
            this.discountCodeElement.innerHTML = `${esc(discountInfo.code)} ${badgeText}`;
          }

          if (this.discountValElement) {
            this.discountValElement.textContent = `-${discountInfo.amountFormatted}`;
          }
        } else {
          this.discountRowElement.hidden = true;
          this.discountRowElement.style.display = "none";
        }
      }

      // Delivery fee
      const fee = this.dynamicDeliveryFee;
      let displayTotal = discountedSubtotal;

      if (this.deliveryValElement) {
        if (fee === null || fee === undefined) {
          this.deliveryValElement.textContent = this.settings.translations.calculatedAtCheckout || "Calculated at checkout";
          this.deliveryValElement.className = "cart-popup-delivery-fee-val cart-popup-delivery-fee-val-calc";
        } else if (fee === 0) {
          this.deliveryValElement.textContent = this.settings.translations.free || "Free";
          this.deliveryValElement.className = "cart-popup-delivery-fee-val cart-popup-delivery-fee-val-free";
        } else {
          this.deliveryValElement.textContent = this.money(fee);
          this.deliveryValElement.className = "cart-popup-delivery-fee-val";
          displayTotal = discountedSubtotal + fee;
        }
      }

      if (this.totalElement) {
        this.totalElement.textContent = this.money(displayTotal);
      }
    },

    renderLineItem(item) {
      const ICONS = window.CartPopupIcons;
      const t = this.settings.translations;
      const productTitle = esc(item.product_title || item.title);
      const variantTitle =
        item.variant_title && item.variant_title !== "Default Title"
          ? `<p class="cart-popup-variant">${esc(item.variant_title)}</p>`
          : "";

      const image = item.image
        ? `<img class="cart-popup-image" src="${esc(item.image)}" alt="${productTitle}" loading="lazy" width="84" height="84" />`
        : `<div class="cart-popup-image" aria-hidden="true"></div>`;

      const isChecked = this.selectedKeys.has(item.key) ? "checked" : "";

      const origLinePrice = Number(item.original_line_price);
      const finalLinePrice = Number(item.final_line_price);

      const hasDiscountAllocation = Array.isArray(item.line_level_discount_allocations) && item.line_level_discount_allocations.length > 0;

      const anyDiscountActive = this._getActiveDiscounts().length > 0 || Boolean(this.appliedDiscount);
      const hasLineDiscount = origLinePrice > finalLinePrice && (hasDiscountAllocation || anyDiscountActive);

      const isGiftLine = this._isGiftLine(item);

      let priceHtml = "";
      let quantityControlsDisabled = false;

      if (isGiftLine) {
        quantityControlsDisabled = true;
        priceHtml = `
          <span class="cart-popup-price">
            <span class="item-price-info">
              ${origLinePrice > 0 ? `<s class="cart-popup-price-original">${this.money(origLinePrice)}</s>` : ""}
              <span class="cart-popup-item-badge cart-popup-item-badge-gift">${esc(t.freeGift || "FREE GIFT")}</span>
            </span> 
            
            <span class="cart-popup-price-discounted">${this.money(0)}</span>
          </span>`;
      } else if (hasLineDiscount) {
        const lineSavings = origLinePrice - finalLinePrice;
        const itemPct = origLinePrice > 0 ? Math.round((lineSavings / origLinePrice) * 100) : 0;
        const badgeHtml = itemPct > 0 ? `<span class="cart-popup-item-badge">${itemPct}% OFF</span>` : "";

        priceHtml = `
          <span class="cart-popup-price">
            <span class="item-price-info">
              <s class="cart-popup-price-original">${this.money(origLinePrice)}</s>
              ${badgeHtml}
            </span> 
            
            <span class="cart-popup-price-discounted">${this.money(finalLinePrice)}</span>
          </span>`;
      } else {
        priceHtml = `<span class="cart-popup-price">${this.money(finalLinePrice || origLinePrice)}</span>`;
      }

      const qtyDisabledAttr = quantityControlsDisabled ? "disabled" : "";

      return `
        <article class="cart-popup-line" data-line-item-key="${esc(item.key)}">
          <div class="cart-popup-line-checkbox">
            <input type="checkbox" class="cart-popup-checkbox"
              data-cart-popup-item-checkbox data-line-key="${esc(item.key)}" ${isChecked} />
          </div>
          <a class="cart-popup-image-link" href="${esc(item.url)}" aria-label="${productTitle}">
            ${image}
          </a>
          <div class="cart-popup-line-details">
            <div class="cart-popup-line-header">
              <a class="cart-popup-product-link" href="${esc(item.url)}">${productTitle}</a>
            </div>
            ${variantTitle}
            ${this.settings.showOrderNote
          ? `<button class="cart-popup-special-request-btn" data-cart-popup-note-toggle type="button">
                  ${ICONS.note} <span>${esc(t.addSpecialRequest || "Add Special Request")}</span>
                 </button>`
          : ""}
            <div class="cart-popup-line-footer">
              ${priceHtml}
              <div class="cart-popup-quantity" aria-label="${esc(t.quantity)}">
                <button class="cart-popup-quantity-button"
                  data-cart-popup-quantity="${item.quantity - 1}"
                  data-line-key="${esc(item.key)}" type="button" ${qtyDisabledAttr}
                  aria-label="${esc(t.decreaseQuantity)}">&minus;</button>
                <span class="cart-popup-quantity-value">${item.quantity}</span>
                <button class="cart-popup-quantity-button"
                  data-cart-popup-quantity="${item.quantity + 1}"
                  data-line-key="${esc(item.key)}" type="button" ${qtyDisabledAttr}
                  aria-label="${esc(t.increaseQuantity)}">&plus;</button>
              </div>
            </div>
          </div>
        </article>`;
    },

    renderVoucher() {
      if (!this.voucherWrapper || !this.voucherCard) return;
      const ICONS = window.CartPopupIcons;
      const t = this.settings.translations;
      const code = this.appliedDiscount;

      const autoDiscounts = this._getActiveDiscounts().filter(
        (d) => d.type !== "discount_code" && d.targetType !== "shipping_line"
      );
      const shippingDiscount = this._getActiveDiscounts().find((d) => d.targetType === "shipping_line");

      const autoNote = autoDiscounts.length
        ? `<div class="cart-popup-voucher-auto-note">${esc(t.autoDiscountApplied || "Also applied automatically")}: ${esc(autoDiscounts.map((d) => d.title).join(", "))}</div>`
        : "";
      const shippingNote = shippingDiscount
        ? `<div class="cart-popup-voucher-auto-note">${esc(t.freeShippingApplied || "Free shipping applied")}: ${esc(shippingDiscount.title)}</div>`
        : "";

      if (code) {
        this.voucherCard.innerHTML = `
          <div class="cart-popup-voucher-left">
            ${ICONS.voucher}
            <span>${esc(t.voucherApplied || "Voucher Applied")}: <strong class="cart-popup-voucher-code-badge">${esc(code)}</strong></span>
          </div>
          <button type="button" class="cart-popup-voucher-remove-btn"
            data-cart-popup-remove-voucher aria-label="Remove discount" title="Remove">&times;</button>
          ${autoNote}${shippingNote}`;
        this.voucherCard.classList.add("is-applied");
        if (this.voucherForm) this.voucherForm.hidden = true;
      } else if (autoDiscounts.length || shippingDiscount) {

        this.voucherCard.innerHTML = `
          <div class="cart-popup-voucher-left">
            ${ICONS.voucher}
            <span>${autoDiscounts.length
            ? esc(autoDiscounts.map((d) => d.title).join(", ")) + " " + esc(t.autoApplied || "applied automatically")
            : esc(t.freeShippingApplied || "Free shipping applied")}</span>
          </div>
          ${shippingDiscount && autoDiscounts.length ? shippingNote : ""}`;
        this.voucherCard.classList.add("is-applied");

        if (this.voucherForm) this.voucherForm.hidden = false;
      } else {
        this.voucherCard.innerHTML = `
          <div class="cart-popup-voucher-left">
            ${ICONS.voucher}
            <span>${esc(t.haveVoucher || "Add voucher / discount code")}</span>
          </div>
          <span class="cart-popup-voucher-arrow">&rsaquo;</span>`;
        this.voucherCard.classList.remove("is-applied");
      }
    },

    showVoucherMessage(text, isError = true) {
      if (!this.voucherMsgElement) return;
      this.voucherMsgElement.textContent = text;
      this.voucherMsgElement.className = `cart-popup-voucher-message ${isError ? "is-error" : "is-success"}`;
      this.voucherMsgElement.hidden = false;
    },

    clearVoucherMessage() {
      if (!this.voucherMsgElement) return;
      this.voucherMsgElement.textContent = "";
      this.voucherMsgElement.hidden = true;
    },

    handleOptimisticQuantityChange(lineKey, newQuantity) {
      if (!Array.isArray(this.cart?.items)) return;
      const item = this.cart.items.find((i) => i.key === lineKey);
      if (!item) return;

      if (this._isGiftLine(item)) return;

      const lineElement = this.root.querySelector(`[data-line-item-key="${CSS.escape(lineKey)}"]`);
      if (!lineElement) return;

      if (newQuantity <= 0) {
        lineElement.style.opacity = "0.4";
      } else {
        const qtyValue = lineElement.querySelector(".cart-popup-quantity-value");
        if (qtyValue) qtyValue.textContent = newQuantity;

        const minusBtn = lineElement.querySelector("[data-cart-popup-quantity]:first-child");
        const plusBtn = lineElement.querySelector("[data-cart-popup-quantity]:last-child");
        if (minusBtn) minusBtn.dataset.cartPopupQuantity = newQuantity - 1;
        if (plusBtn) plusBtn.dataset.cartPopupQuantity = newQuantity + 1;

        const unitPrice = item.final_price || (item.final_line_price / (item.quantity || 1));
        const priceElement = lineElement.querySelector(".cart-popup-price-discounted") || lineElement.querySelector(".cart-popup-price");
        if (priceElement) priceElement.textContent = this.money(unitPrice * newQuantity);
      }

      item.quantity = newQuantity;
      this.cart.item_count = this.cart.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      this.cart.total_price = this.getCartSubtotal();

      this.renderTotals();
      this.updateHeaderCount();

      if (this.debounceTimers.has(lineKey)) window.clearTimeout(this.debounceTimers.get(lineKey));
      const timer = window.setTimeout(async () => {
        this.debounceTimers.delete(lineKey);
        await this.syncQuantityWithServer(lineKey, newQuantity);
      }, 250);
      this.debounceTimers.set(lineKey, timer);
    },

    updateHeaderCount() {
      const count = Number(this.cart?.item_count) || 0;
      document.querySelectorAll("[data-cart-popup-count]").forEach((el) => {
        el.setAttribute("data-count", String(count));
        if (count > 0) {
          el.textContent = count;
          el.hidden = false;
          el.style.display = "flex";
          el.classList.remove("cart-popup-count-pop");
          void el.offsetWidth;
          el.classList.add("cart-popup-count-pop");
        } else {
          el.textContent = "";
          el.hidden = true;
          el.style.display = "none";
        }
      });
    },

    setStatus(msg) {
      if (this.statusElement) this.statusElement.textContent = msg;
    },

  };
})();