let sdkPromise;
let sdkClient;
let checkoutOpen = false;

export function loadPayPalSDK(clientID) {
  if (sdkPromise && sdkClient === clientID) return sdkPromise;
  if (sdkPromise) return Promise.reject(new Error("Payment settings changed. Refresh the page to continue."));
  sdkClient = clientID;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const query = new URLSearchParams({ "client-id": clientID, components: "buttons,card-fields", currency: "USD", intent: "capture" });
    script.src = `https://www.paypal.com/sdk/js?${query}`;
    script.dataset.namespace = "bugmegaPayPal";
    const timer = setTimeout(() => fail(), 25000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      sdkPromise = undefined;
      reject(new Error("Could not load secure payments. Check your connection or continue on PayPal."));
    }
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timer);
      if (!window.bugmegaPayPal) { fail(); return; }
      resolve(window.bugmegaPayPal);
    };
    document.head.append(script);
  });
  return sdkPromise;
}

// Card inputs are PayPal-hosted iframes; Bugmega never reads or sends card numbers.
export async function openEmbeddedCheckout({ api, title, description, amount, orderID, captureURL, fallbackURL, onSuccess }) {
  if (checkoutOpen) throw new Error("A checkout is already open.");
  if (!orderID || !Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid checkout. Please try again.");
  checkoutOpen = true;
  const dialog = document.createElement("dialog");
  dialog.className = "embedded-checkout";
  dialog.setAttribute("aria-labelledby", "checkout-title");
  dialog.innerHTML = `<button type="button" class="checkout-close" aria-label="Close checkout">×</button>
    <aside class="checkout-summary"><div class="checkout-brand">bugmega<span>SECURE CHECKOUT</span></div>
      <h2 id="checkout-title"></h2><p class="checkout-description"></p>
      <div class="checkout-total-label">Total due today</div><div class="checkout-total"></div>
      <div class="checkout-line"><span>Currency</span><strong>USD</strong></div>
      <p class="checkout-protection">Payments processed securely by PayPal. Card details are entered directly into PayPal’s secure fields.</p>
    </aside>
    <section class="checkout-payment"><h3>Payment details</h3><p class="checkout-intro">Choose how you’d like to pay.</p>
      <div class="checkout-status" role="status" aria-live="polite">Loading secure payment options…</div>
      <div class="checkout-methods"><div id="checkout-paypal-buttons"></div>
        <div class="checkout-card" hidden><div class="checkout-divider"><span>Or pay by card</span></div>
          <div class="checkout-field-label">Name on card</div><div id="checkout-card-name" class="checkout-hosted-field"></div>
          <div class="checkout-field-label">Card number</div><div id="checkout-card-number" class="checkout-hosted-field"></div>
          <div class="checkout-card-row"><div><div class="checkout-field-label">Expiration date</div><div id="checkout-card-expiry" class="checkout-hosted-field"></div></div>
          <div><div class="checkout-field-label">Security code</div><div id="checkout-card-cvv" class="checkout-hosted-field"></div></div></div>
          <button type="button" class="checkout-pay">Pay securely</button>
        </div>
      </div>
      <button type="button" class="checkout-retry" hidden>Retry payment confirmation</button>
      <a class="checkout-fallback" hidden rel="noopener">Continue on PayPal</a>
      <button type="button" class="checkout-done" hidden>Done</button>
      <p class="checkout-footnote">PayPal or your bank may open a window to confirm your payment.</p>
    </section>`;
  const find = selector => dialog.querySelector(selector);
  const formatted = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
  find("h2").textContent = title;
  find(".checkout-description").textContent = description;
  find(".checkout-total").textContent = formatted;
  find(".checkout-pay").textContent = `Pay ${formatted}`;
  if (fallbackURL) {
    const url = new URL(fallbackURL, location.origin);
    if (url.protocol === "https:" && /(^|\.)paypal\.com$/.test(url.hostname)) {
      find(".checkout-fallback").href = url.href;
    }
  }
  document.body.append(dialog);
  dialog.showModal();
  let busy = false, approved = false, paid = false, disposed = false, confirming = false, buttons, cards;
  function status(text, error = false) {
    find(".checkout-status").textContent = text;
    find(".checkout-status").classList.toggle("is-error", error);
  }
  function setBusy(value) {
    busy = value;
    find(".checkout-pay").disabled = value;
    find(".checkout-close").disabled = value;
    find(".checkout-retry").disabled = value;
  }
  function close() {
    if (busy) return;
    disposed = true;
    buttons?.close?.();
    // Removing the dialog also removes PayPal's hosted field iframes.
    dialog.close();
    dialog.remove();
    checkoutOpen = false;
    if (paid) Promise.resolve(onSuccess?.()).catch(() => { location.reload(); });
  }
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  find(".checkout-close").onclick = close;
  find(".checkout-done").onclick = close;
  async function confirm(data) {
    if (paid || confirming) return;
    if (data?.orderID && data.orderID !== orderID) throw new Error("Checkout order does not match.");
    approved = true;
    confirming = true;
    setBusy(true);
    find(".checkout-methods").hidden = true;
    find(".checkout-fallback").hidden = true;
    status("Confirming your payment. Please keep this window open…");
    try {
      await api(captureURL, { method: "POST", body: "{}" });
      paid = true;
      status("Payment successful. Thank you!");
      find(".checkout-retry").hidden = true;
      find(".checkout-done").hidden = false;
      find(".checkout-footnote").textContent = "Your payment has been verified and your account updated.";
    } catch (error) {
      status(error.message || "Confirmation is pending. Retry confirmation before starting another payment.", true);
      find(".checkout-retry").hidden = false;
    } finally { confirming = false; setBusy(false); }
  }
  find(".checkout-retry").onclick = () => confirm();
  function paymentError() {
    if (disposed || paid || approved) return;
    setBusy(false);
    status("Payment was not completed. Check your details and try again, or choose PayPal.", true);
  }
  try {
    const config = await api("/api/paypal/config");
    const paypal = await loadPayPalSDK(config.client_id);
    if (disposed) return;
    const callbacks = {
      createOrder: () => { if (approved || paid) throw new Error("Please confirm the existing payment."); return orderID; },
      onApprove: confirm,
      onError: paymentError,
      onCancel: () => { if (!approved) { setBusy(false); status("Payment cancelled. You can try again when ready."); } },
    };
    buttons = paypal.Buttons({ ...callbacks, onClick: () => setBusy(true), style: { layout: "vertical", shape: "rect", color: "gold", label: "paypal", height: 45 } });
    await buttons.render(find("#checkout-paypal-buttons"));
    if (disposed) return;
    status("");
    if (paypal.CardFields) {
      cards = paypal.CardFields({ ...callbacks, style: { input: { "font-size": "16px", "font-family": "Arial, sans-serif", color: "#202123" }, ".invalid": { color: "#b42318" } } });
      if (cards.isEligible()) {
        find(".checkout-card").hidden = false;
        await Promise.all([
          cards.NameField({ placeholder: "Full name" }).render("#checkout-card-name"),
          cards.NumberField({ placeholder: "Card number" }).render("#checkout-card-number"),
          cards.ExpiryField({ placeholder: "MM / YY" }).render("#checkout-card-expiry"),
          cards.CVVField({ placeholder: "CVV" }).render("#checkout-card-cvv"),
        ]);
        find(".checkout-pay").onclick = async () => {
          setBusy(true);
          status("Processing securely…");
          try { await cards.submit(); } catch { paymentError(); }
          finally { if (!approved) setBusy(false); }
        };
      } else { status("Pay with PayPal. Direct card entry is unavailable for this checkout."); }
    }
  } catch (error) {
    if (disposed) return;
    find(".checkout-card").hidden = true;
    status(error.message || "Secure checkout is unavailable.", true);
    find(".checkout-fallback").hidden = !find(".checkout-fallback").hasAttribute("href");
  }
}
