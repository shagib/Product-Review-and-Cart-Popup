/**
 * cart-popup-api.js
 * Handles all Shopify Cart Ajax API communication:
 *   - fetch cart / refresh state
 *   - update item quantities
 *   - apply / remove discount codes (with server-side validation)
 *   - update order note
 *   - watch fetch mutations to auto-refresh
 *
 * Requires: window.CartPopupApi is called by CartPopup core after init.
 * Exports:  window.CartPopupApi (class mixin object – methods are merged into CartPopup)
 */
(() => {
  /**
   * XSS-safe HTML escaper
   */
  const esc = (v) =>
    String(v || "").replace(/[&<>'"]/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[c]);

  window.CartPopupApi = {

    async refresh() {
      try {
        const res = await this.originalFetch(
          `${this.settings.cartUrl.replace(/\/$/, "")}.js`,
          { headers: { Accept: "application/json" } }
        );
        if (!res.ok) throw new Error("Failed to fetch cart");
        this.cart = await res.json();

        // Verify if previously saved discount is still valid/applied on this cart
        if (this.appliedDiscount && !this._checkDiscountApplied(this.cart, this.appliedDiscount)) {
          this.appliedDiscount = "";
          try { sessionStorage.removeItem("cart_popup_discount"); } catch { }
          this.updateCheckoutUrl();
        }

        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] refresh error:", err);
      }
    },

    getCartEndpoint(action) {
      return `${this.settings.cartUrl.replace(/\/$/, "")}/${action}.js`;
    },

    async syncQuantityWithServer(lineKey, quantity) {
      try {
        const res = await this.originalFetch(this.getCartEndpoint("change"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ id: lineKey, quantity }),
        });
        if (!res.ok) throw new Error("Server rejected update");
        this.cart = await res.json();
        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] quantity sync error:", err);
        this.refresh();
      }
    },

    async executeBulkDelete() {
      if (this.selectedKeys.size === 0) return;

      const updates = {};
      this.selectedKeys.forEach((key) => { updates[key] = 0; });

      this.selectedKeys.forEach((key) => {
        const line = this.root.querySelector(`[data-line-item-key="${CSS.escape(key)}"]`);
        if (line) line.style.opacity = "0.2";
      });

      try {
        const res = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        if (!res.ok) throw new Error("Bulk delete failed");
        this.cart = await res.json();
        this.setDeleteMode(false);
        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] bulk delete error:", err);
        this.refresh();
      }
    },

    async addProductForm(form) {
      this.setStatus("");
      try {
        const res = await this.originalFetch(this.getCartEndpoint("add"), {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        });
        if (!res.ok) throw new Error("Could not add product");
        await this.refresh();
        if (this.settings.openAfterAdd) this.open();
      } catch (err) {
        console.error(err);
        this.setStatus(this.settings.translations.cartError);
      }
    },

    async updateNote() {
      if (!this.noteElement) return;
      try {
        await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ note: this.noteElement.value }),
        });
      } catch (err) {
        console.error("[CartPopup] note update error:", err);
      }
    },

    /* ------------------------------------------------------------------
     * Discount Code Verification & Server Authentication
     * ------------------------------------------------------------------ */

    _checkDiscountApplied(cart, code) {
      if (!cart || !code) return false;
      const target = code.trim().toUpperCase();

      // Primary check: Shopify's discount_codes[].applicable boolean
      if (Array.isArray(cart.discount_codes) && cart.discount_codes.length > 0) {
        const entry = cart.discount_codes.find((d) => {
          const c = (typeof d === "string" ? d : (d.code || "")).trim().toUpperCase();
          return c === target;
        });

        if (entry) {
          return entry.applicable !== false;
        }
      }

      // Fallback 1: discount_applications
      if (Array.isArray(cart.discount_applications) && cart.discount_applications.length > 0) {
        const match = cart.discount_applications.some((d) => {
          const title = (d.title || d.key || d.code || "").trim().toUpperCase();
          return title === target;
        });
        if (match) return true;
      }

      // Fallback 2: line-level discount allocations
      if (Array.isArray(cart.items)) {
        const match = cart.items.some((item) => {
          if (Array.isArray(item.line_level_discount_allocations)) {
            return item.line_level_discount_allocations.some((alloc) => {
              const app = alloc.discount_application;
              if (!app) return false;
              return (app.title || app.key || app.code || "").trim().toUpperCase() === target;
            });
          }
          if (Array.isArray(item.discounts)) {
            return item.discounts.some((d) =>
              (d.title || d.code || "").trim().toUpperCase() === target
            );
          }
          return false;
        });
        if (match) return true;
      }

      return false;
    },

    async applyDiscount(code) {
      const cleanCode = (code || "").toUpperCase().trim();
      this.clearVoucherMessage();

      if (!cleanCode) {
        this.showVoucherMessage("Please enter a discount code.", true);
        return;
      }

      const applyBtn = this.root.querySelector("[data-cart-popup-apply-voucher]");
      const originalBtnHTML = applyBtn ? applyBtn.innerHTML : "";
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.innerHTML = `<span class="cart-popup-btn-spinner" aria-label="Loading"></span>`;
      }

      try {
        const res = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ discount: cleanCode }),
        });

        if (!res.ok) {
          let msg = `Discount code "${esc(cleanCode)}" is not valid.`;
          try {
            const err = await res.json();
            if (err.description) msg = err.description;
            else if (err.message) msg = err.message;
          } catch {}
          this.showVoucherMessage(msg, true);
          return;
        }

        const updatedCart = await res.json();
        const isApplied = this._checkDiscountApplied(updatedCart, cleanCode);

        if (!isApplied) {
          await this.originalFetch(this.getCartEndpoint("update"), {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ discount: "" }),
          });

          this.appliedDiscount = "";
          try { sessionStorage.removeItem("cart_popup_discount"); } catch {}
          this.updateCheckoutUrl();

          this.showVoucherMessage(
            `Discount code "${esc(cleanCode)}" is invalid or not applicable to your cart.`,
            true
          );
          await this.refresh();
          return;
        }

        this.cart = updatedCart;
        this.appliedDiscount = cleanCode;
        try { sessionStorage.setItem("cart_popup_discount", cleanCode); } catch {}

        try {
          await this.originalFetch(`/discount/${encodeURIComponent(cleanCode)}?redirect=/cart.js`);
        } catch {}

        const discountAmt = updatedCart.total_discount || 0;
        const savingsText = discountAmt > 0 ? ` (${this.money(discountAmt)} saved)` : "";
        this.showVoucherMessage(`Code "${esc(cleanCode)}" applied! ✓${savingsText}`, false);

        this.updateCheckoutUrl();
        this.render();
        this.fetchShippingRates();

      } catch (err) {
        console.error("[CartPopup] discount apply error:", err);
        this.showVoucherMessage("Failed to apply discount. Please try again.", true);
      } finally {
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.innerHTML = originalBtnHTML || (this.settings.translations.apply || "Apply");
        }
      }
    },

    async removeDiscount() {
      this.appliedDiscount = "";
      this.clearVoucherMessage();
      if (this.voucherInput) this.voucherInput.value = "";
      try {
        sessionStorage.removeItem("cart_popup_discount");
        const res = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ discount: "" }),
        });
        if (res.ok) this.cart = await res.json();
        // Also clear Shopify session cookie
        await this.originalFetch("/discount/CLEAR?redirect=/cart.js");
      } catch (err) {
        console.error("[CartPopup] discount remove error:", err);
      }
      this.updateCheckoutUrl();
      this.render();
    },

    updateCheckoutUrl() {
      if (!this.checkoutButton) return;
      const base = this.settings.checkoutUrl;
      this.checkoutButton.href = this.appliedDiscount
        ? `/discount/${encodeURIComponent(this.appliedDiscount)}?redirect=${encodeURIComponent(base)}`
        : base;
    },

    /* ------------------------------------------------------------------
     * Dynamic Delivery / Shipping Rates API
     * Fetches store's real shipping rates from Shopify Ajax Cart API.
     * ------------------------------------------------------------------ */

    async fetchShippingRates() {
      const items = this.cart?.items || [];
      const requiresShipping = items.some((item) => item.requires_shipping !== false);

      if (items.length === 0 || !requiresShipping) {
        this.dynamicDeliveryFee = 0;
        this.shippingRateTitle = "";
        this.renderTotals();
        return;
      }

      const addr = this.settings.shippingAddress || {};
      const country = addr.country || addr.countryCode || window.Shopify?.country || "";
      const province = addr.province || "";
      const zip = addr.zip || "";

      const queryParams = new URLSearchParams();
      if (country) queryParams.append("shipping_address[country]", country);
      if (province) queryParams.append("shipping_address[province]", province);
      if (zip) queryParams.append("shipping_address[zip]", zip);

      const qs = queryParams.toString();
      const baseUrl = (this.settings.cartUrl || "/cart").replace(/\/$/, "");
      const endpoint = `${baseUrl}/shipping_rates.json${qs ? `?${qs}` : ""}`;

      try {
        let res = await this.originalFetch(endpoint, {
          headers: { Accept: "application/json" },
        });

        // If Shopify requests asynchronous calculation
        if (res.status === 202) {
          await this.originalFetch(`${baseUrl}/prepare_shipping_rates.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ shipping_address: { country, province, zip } }),
          });

          for (let i = 0; i < 3; i++) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            const asyncRes = await this.originalFetch(
              `${baseUrl}/async_shipping_rates.json${qs ? `?${qs}` : ""}`,
              { headers: { Accept: "application/json" } }
            );
            if (asyncRes.ok) {
              const data = await asyncRes.json();
              if (data && Array.isArray(data.shipping_rates)) {
                res = { ok: true, json: async () => data };
                break;
              }
            }
          }
        }

        if (res.ok) {
          const data = await res.json();
          const rates = data?.shipping_rates;
          if (Array.isArray(rates) && rates.length > 0) {
            let minRate = rates[0];
            for (let i = 1; i < rates.length; i++) {
              if (parseFloat(rates[i].price) < parseFloat(minRate.price)) {
                minRate = rates[i];
              }
            }
            this.dynamicDeliveryFee = Math.round(parseFloat(minRate.price) * 100);
            this.shippingRateTitle = minRate.presentment_title || minRate.title || minRate.name || "";
            this.renderTotals();
            return;
          }
        }
      } catch (err) {
        console.warn("[CartPopup] dynamic delivery fee fetch error:", err);
      }

      // If rates cannot be calculated for the destination
      this.dynamicDeliveryFee = null;
      this.shippingRateTitle = "";
      this.renderTotals();
    },

    /* ------------------------------------------------------------------
     * Fetch Watcher – auto-refresh on any cart mutation from theme code
     * ------------------------------------------------------------------ */

    watchCartRequests() {
      window.fetch = async (...args) => {
        const response = await this.originalFetch(...args);
        const url = this._getRequestUrl(args[0]);
        if (this._isCartMutation(url)) {
          window.setTimeout(() => {
            this.refresh();
            if (url.includes("/cart/add") && this.settings.openAfterAdd) this.open();
          }, 50);
        }
        return response;
      };
    },

    _isCartMutation(url) {
      return /\/cart\/(add|change|update|clear)(\.js)?(?:\?|$)/.test(url);
    },

    _getRequestUrl(req) {
      return req instanceof Request ? req.url : String(req || "");
    },

  };
})();
