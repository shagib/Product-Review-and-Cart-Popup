(function () {
  async function initReviewApp() {
    const container = document.querySelector(".product-review-container");
    if (!container) return;

    const shop = container.dataset.shop;
    const productId = container.dataset.productId;
    const reviewList = document.getElementById("reviews-list");

    // App Proxy URL
    const proxyBaseUrl = "/apps/reviews";
    const api_url = `${proxyBaseUrl}?shop=${encodeURIComponent(shop)}&productId=${encodeURIComponent(productId)}`;

    try {
      const res = await fetch(api_url);
      if (!res.ok) throw new Error("API Route Not Found or Failed");

      const data = await res.json();

      if (data.isReviewActive === true) {
        container.style.display = "block";
      } else {
        container.style.display = "none";
        return;
      }

      container.style.display = "block";

      if (data.reviews && data.reviews.length > 0) {
        reviewList.innerHTML = data.reviews.map((item) => {
            const name = item.customerName || item.name || "Anonymous";
            const rating = Number(item.rating) || 5;
            const comment = item.comment || "";

            return `
              <div style="border-bottom: 1px solid #eee; padding: 10px 0;">
                <div style="font-weight: bold;">${name} <span style="color: #f39c12;">${"⭐".repeat(rating)}</span></div>
                <p style="margin: 5px 0 0 0; color: #333;">${comment}</p>
              </div>
            `;
          }).join("");
      } else {
        reviewList.innerHTML = "<p>No reviews yet.</p>";
      }
    } catch (err) {
      console.error("Error Loading reviews:", err);
      container.style.display = "none";
    }
  }

  document.addEventListener("submit", async function (e) {
    if (e.target && e.target.id === "submit-review-form") {
      e.preventDefault();

      const form = e.target;
      const container = document.querySelector(".product-review-container");
      const shop = container ? container.dataset.shop : "";
      const productId = container ? container.dataset.productId : "";

      const submitBtn = form.querySelector("button[type='submit']");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = "Submitting...";
      }

      const formData = {
        shopifyDomain: shop,
        productId: productId,
        customerName: document.getElementById("customerName")?.value || "",
        rating: document.getElementById("rating")?.value || "5",
        comment: document.getElementById("comment")?.value || "",
      };

      try {
        const response = await fetch(`/apps/reviews?shop=${encodeURIComponent(shop)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const result = await response.json();
        if (result.success) {
          alert("Thank you for review! Your Review has been submitted.");
          form.reset();
        } else {
          alert(result.message || "Failed to submit review");
        }
      } catch (error) {
        console.error("Submission Error:", error);
        alert("Something went wrong. Please try again.");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Submit Review";
        }
      }
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReviewApp);
  } else {
    initReviewApp();
  }
})();