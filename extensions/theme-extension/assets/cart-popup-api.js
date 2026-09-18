/**
 * cart-popup-api.js
 * Handles all Shopify Cart Ajax API communication
 */
(() => {
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
        const cartData = await res.json();

        await this.updateCartState(cartData);
        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] refresh error:", err);
      }
    },

    _extractDiscountApplications(cart) {
      if (!cart || !Array.isArray(cart.discount_applications)) return [];
      return cart.discount_applications.map((app) => ({
        title: app.title || app.description || "Discount",
        type: app.type || "automatic",
        targetType: app.target_type || "line_item",
        targetSelection: app.target_selection || "all",
        valueType: app.value_type || null,
        value: app.value != null ? Number(app.value) : null,
        allocationMethod: app.allocation_method || null,
      }));
    },

    async updateCartState(cartData) {
      this.cart = cartData;

      const isEmpty = !this.cart || !this.cart.items || this.cart.items.length === 0;

      if (isEmpty) {
        this.appliedDiscount = "";
        this.activeDiscounts = [];
        try {
          sessionStorage.removeItem("cart_popup_discount");
        } catch (e) {
          console.error(e);
        }

        if (navigator.onLine) {
          try {
            const clearRes = await this.originalFetch(this.getCartEndpoint("update"), {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/json" },
              body: JSON.stringify({ discount: "" }),
            });
            if (!clearRes.ok) {
              console.error("[CartPopup] discount clear rejected with status:", clearRes.status);
            }
          } catch (err) {
            console.error("[CartPopup] discount clear error:", err);
          }

          try {
            const legacyRes = await this.originalFetch("/discount/CLEAR?redirect=/cart.js");
            if (!legacyRes.ok) {
              console.error("[CartPopup] legacy discount clear rejected with status:", legacyRes.status);
            }
          } catch (err) {
            console.error("[CartPopup] legacy discount clear error:", err);
          }
        }

        this.updateCheckoutUrl();
        return;
      }

      this.activeDiscounts = this._extractDiscountApplications(this.cart);
      const activeCodeDiscount = this.activeDiscounts.find((d) => d.type === "discount_code");

      if (!this.appliedDiscount) {
        try {
          this.appliedDiscount = sessionStorage.getItem("cart_popup_discount") || "";
        } catch (e) { }
      }

      if (this.appliedDiscount) {
        const stillApplied =
          activeCodeDiscount &&
          activeCodeDiscount.title.trim().toUpperCase() === this.appliedDiscount.trim().toUpperCase();

        if (!stillApplied) {
          this.appliedDiscount = "";
          try { sessionStorage.removeItem("cart_popup_discount"); } catch (e) { }
        }
      }

      if (!this.appliedDiscount && activeCodeDiscount) {
        try {
          const res = await this.originalFetch(this.getCartEndpoint("update"), {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({ discount: "" }),
          });
          if (res.ok) {
            this.cart = await res.json();
            this.activeDiscounts = this._extractDiscountApplications(this.cart);
          } else {
            console.error("[CartPopup] orphan discount-code clear rejected with status:", res.status);
          }
        } catch (err) {
          console.error("[CartPopup] orphan discount-code clear error:", err);
        }
      }

      this.updateCheckoutUrl();
    },

    getCartEndpoint(action) {
      return `${this.settings.cartUrl.replace(/\/$/, "")}/${action}.js`;
    },

    async syncQuantityWithServer(lineKey, quantity) {
      const lineElement = this.root ? this.root.querySelector(`[data-line-item-key="${CSS.escape(lineKey)}"]`) : null;
      const footerElement = this.root ? this.root.querySelector(".cart-popup-footer") : null;

      if (lineElement) {
        lineElement.classList.add("is-updating");
        lineElement.querySelectorAll("button").forEach((btn) => (btn.disabled = true));
      }
      if (footerElement) footerElement.classList.add("is-updating");

      try {
        const payload = {
          id: lineKey,
          quantity: Number(quantity)
        };

        const res = await this.originalFetch(this.getCartEndpoint("change"), {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          throw new Error(`Server rejected update with status: ${res.status}`);
        }

        const cartData = await res.json();
        await this.updateCartState(cartData);
        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] quantity sync error:", err);
        await this.refresh();
      } finally {
        if (lineElement) {
          lineElement.classList.remove("is-updating");
          lineElement.querySelectorAll("button").forEach((btn) => (btn.disabled = false));
        }
        if (footerElement) footerElement.classList.remove("is-updating");
      }
    },

    async executeBulkDelete() {
      if (!this.selectedKeys || this.selectedKeys.size === 0) return;

      const updates = {};
      this.selectedKeys.forEach((key) => { updates[key] = 0; });

      this.selectedKeys.forEach((key) => {
        const line = this.root ? this.root.querySelector(`[data-line-item-key="${CSS.escape(key)}"]`) : null;
        if (line) line.classList.add("is-updating");
      });

      try {
        const res = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        if (!res.ok) throw new Error("Bulk delete failed");

        const cartData = await res.json();
        if (typeof this.setDeleteMode === "function") {
          this.setDeleteMode(false);
        }
        await this.updateCartState(cartData);
        this.render();
        this.fetchShippingRates();
      } catch (err) {
        console.error("[CartPopup] bulk delete error:", err);
        await this.refresh();
      }
    },

    async addProductForm(form) {
      if (typeof this.setStatus === "function") this.setStatus("");
      try {
        const res = await this.originalFetch(this.getCartEndpoint("add"), {
          method: "POST",
          headers: { Accept: "application/json" },
          body: new FormData(form),
        });
        if (!res.ok) throw new Error("Could not add product");
        await this.refresh();
        if (this.settings.openAfterAdd && typeof this.open === "function") this.open();
      } catch (err) {
        console.error(err);
        if (typeof this.setStatus === "function") {
          this.setStatus(this.settings.translations?.cartError || "Error adding product");
        }
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

    _checkDiscountApplied(cart, code) {
      if (!cart || !code) return false;
      const target = code.trim().toUpperCase();

      if (Array.isArray(cart.discount_codes) && cart.discount_codes.length > 0) {
        const entry = cart.discount_codes.find((d) => {
          const c = (typeof d === "string" ? d : (d.code || "")).trim().toUpperCase();
          return c === target;
        });

        if (entry) {
          return entry.applicable !== false;
        }
      }

      if (Array.isArray(cart.discount_applications) && cart.discount_applications.length > 0) {
        const match = cart.discount_applications.some((d) => {
          const title = (d.title || d.key || d.code || "").trim().toUpperCase();
          return title === target;
        });
        if (match) return true;
      }

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
      if (typeof this.clearVoucherMessage === "function") this.clearVoucherMessage();

      if (!cleanCode) {
        if (typeof this.showVoucherMessage === "function") {
          this.showVoucherMessage("Please enter a discount code.", true);
        }
        return;
      }

      const applyBtn = this.root ? this.root.querySelector("[data-cart-popup-apply-voucher]") : null;
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
          } catch { }
          if (typeof this.showVoucherMessage === "function") this.showVoucherMessage(msg, true);
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
          try { sessionStorage.removeItem("cart_popup_discount"); } catch { }
          this.updateCheckoutUrl();

          if (typeof this.showVoucherMessage === "function") {
            this.showVoucherMessage(
              `This code "${esc(cleanCode)}" is invalid.`,
              true
            );
          }
          await this.refresh();
          return;
        }

        this.cart = updatedCart;
        this.appliedDiscount = cleanCode;
        this.activeDiscounts = this._extractDiscountApplications(updatedCart);
        try { sessionStorage.setItem("cart_popup_discount", cleanCode); } catch { }

        try {
          await this.originalFetch(`/discount/${encodeURIComponent(cleanCode)}?redirect=/cart.js`);
        } catch { }

        const discountAmt = updatedCart.total_discount || 0;
        const savingsText = discountAmt > 0 && typeof this.money === "function" ? ` (${this.money(discountAmt)} saved)` : "";
        if (typeof this.showVoucherMessage === "function") {
          this.showVoucherMessage(`Code "${esc(cleanCode)}" applied! ✓${savingsText}`, false);
        }

        this.updateCheckoutUrl();
        this.render();
        this.fetchShippingRates();

      } catch (err) {
        console.error("[CartPopup] discount apply error:", err);
        if (typeof this.showVoucherMessage === "function") {
          this.showVoucherMessage("Failed to apply discount. Please try again.", true);
        }
      } finally {
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.innerHTML = originalBtnHTML || (this.settings.translations?.apply || "Apply");
        }
      }
    },

    async removeDiscount() {
      this.appliedDiscount = "";
      if (typeof this.clearVoucherMessage === "function") this.clearVoucherMessage();
      if (this.voucherInput) this.voucherInput.value = "";
      try {
        sessionStorage.removeItem("cart_popup_discount");
        const res = await this.originalFetch(this.getCartEndpoint("update"), {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ discount: "" }),
        });
        if (res.ok) {
          this.cart = await res.json();
          this.activeDiscounts = this._extractDiscountApplications(this.cart);
        }
        await this.originalFetch("/discount/CLEAR?redirect=/cart.js");
      } catch (err) {
        console.error("[CartPopup] discount remove error:", err);
      }
      this.updateCheckoutUrl();
      this.render();
    },

    updateCheckoutUrl() {
      if (!this.checkoutButton) return;
      const base = this.settings.checkoutUrl || "/checkout";
      this.checkoutButton.href = this.appliedDiscount
        ? `/discount/${encodeURIComponent(this.appliedDiscount)}?redirect=${encodeURIComponent(base)}`
        : base;
    },

    async fetchShippingRates() {
      const items = this.cart?.items || [];
      const requiresShipping = items.some((item) => item.requires_shipping !== false);

      if (items.length === 0 || !requiresShipping) {
        this.dynamicDeliveryFee = 0;
        this.shippingRateTitle = "";
        if (typeof this.renderTotals === "function") this.renderTotals();
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
            if (typeof this.renderTotals === "function") this.renderTotals();
            return;
          }
        }
      } catch (err) {
        console.warn("[CartPopup] dynamic delivery fee fetch error:", err);
      }

      this.dynamicDeliveryFee = null;
      this.shippingRateTitle = "";
      if (typeof this.renderTotals === "function") this.renderTotals();
    },

    watchCartRequests() {
      if (window.__cartPopupFetchPatched) return;
      window.__cartPopupFetchPatched = true;

      if (!this.originalFetch) {
        this.originalFetch = window.fetch.bind(window);
      }

      window.fetch = async (...args) => {
        const response = await this.originalFetch(...args);
        const url = this._getRequestUrl(args[0]);
        if (this._isCartMutation(url)) {
          window.setTimeout(() => {
            this.refresh();
            if (url.includes("/cart/add") && this.settings.openAfterAdd && typeof this.open === "function") {
              this.open();
            }
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