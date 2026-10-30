/* Site Builder effects runtime.
 *
 * Dependency-free replacement for the animation / slider / counter / menu
 * scripts that were stripped when the site was cloned. It reads the neutral
 * `data-sb-*` attributes written at clone time (see lib/effects-extract.ts in
 * Site Builder) and also recognises a few common class patterns directly
 * (Elementor menus, accordions, tabs, Bootstrap collapse/tabs, anchor links).
 *
 * window.SBEffects.init()  — scan the document (idempotent, safe to call often)
 * window.SBEffects.refresh() — re-layout sliders (after DOM edits)
 * window.SBEffects.destroy()
 */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var html = document.documentElement;
  var editing = function () { return html.hasAttribute("data-sb-editing"); };
  var mediaReduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var forcedReduced = null; // set by SBEffects.setReducedMotion() (accessibility widget)
  // Dynamic: OS preference, the widget's "Stop animations" (html.sb-a11y-no-motion),
  // or an explicit override. Checked at use time, never cached.
  function reduced() {
    if (forcedReduced !== null) return forcedReduced;
    if (html.classList.contains("sb-a11y-no-motion")) return true;
    return !!(mediaReduced && mediaReduced.matches);
  }
  var TABLET = 1024;
  var MOBILE = 767;

  var state = {
    started: false,
    animObserver: null,
    counterObserver: null,
    sliders: [],
    parallax: [],
    mutation: null,
    scrollBound: false,
    clickBound: false,
    rafPending: false,
  };

  function ready(el) { return el.__sbReady === true; }
  function markReady(el) { el.__sbReady = true; }

  /* ---------------------------------------------------------------- */
  /* entrance animations                                                */
  /* ---------------------------------------------------------------- */

  function animate(el) {
    var delay = parseInt(el.getAttribute("data-sb-delay") || "0", 10);
    var duration = parseInt(el.getAttribute("data-sb-duration") || "0", 10);
    if (delay > 0) el.style.setProperty("--sb-delay", delay + "ms");
    if (duration > 0) el.style.setProperty("--sb-duration", duration + "ms");
    el.classList.add("sb-in");
  }

  function scanAnimations(root) {
    var nodes = root.querySelectorAll("[data-sb-anim]");
    if (!nodes.length) return;
    if (reduced() || editing() || !("IntersectionObserver" in window)) {
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.add("sb-in");
      return;
    }
    if (!state.animObserver) {
      state.animObserver = new IntersectionObserver(function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isIntersecting || entries[j].intersectionRatio > 0) {
            animate(entries[j].target);
            state.animObserver.unobserve(entries[j].target);
          }
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    }
    for (var k = 0; k < nodes.length; k++) {
      var el = nodes[k];
      if (ready(el)) continue;
      markReady(el);
      if (el.classList.contains("sb-in")) continue;
      state.animObserver.observe(el);
    }
  }

  /* ---------------------------------------------------------------- */
  /* counters                                                           */
  /* ---------------------------------------------------------------- */

  function formatLike(sample, value, decimals) {
    var fixed = value.toFixed(decimals);
    var parts = fixed.split(".");
    var useSep = /\d[,.]\d{3}(?!\d)/.test(sample) || /\d,\d/.test(sample);
    var sep = /\d\.\d{3}(?!\d)/.test(sample) && !/\d,\d/.test(sample) ? "." : ",";
    var dec = sep === "." ? "," : ".";
    var intPart = useSep ? parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, sep) : parts[0];
    return decimals > 0 ? intPart + dec + parts[1] : intPart;
  }

  function runCounter(el) {
    var to = parseFloat(el.getAttribute("data-sb-counter"));
    if (!isFinite(to)) return;
    var from = parseFloat(el.getAttribute("data-sb-counter-from") || "0");
    if (!isFinite(from)) from = 0;
    var duration = parseInt(el.getAttribute("data-sb-counter-duration") || "2000", 10);
    var original = el.textContent || "";
    var match = original.match(/-?[\d.,]*\d/);
    var prefix = match ? original.slice(0, match.index) : "";
    var suffix = match ? original.slice(match.index + match[0].length) : "";
    var decimals = 0;
    var toText = el.getAttribute("data-sb-counter") || "";
    if (toText.indexOf(".") >= 0) decimals = toText.split(".")[1].length;
    else if (match && /[.,]\d{1,2}$/.test(match[0])) decimals = match[0].split(/[.,]/).pop().length;
    var sample = match ? match[0] : String(to);
    if (reduced() || editing()) { el.textContent = original; return; }
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / Math.max(200, duration));
      var eased = 1 - Math.pow(1 - t, 3);
      var value = from + (to - from) * eased;
      el.textContent = prefix + formatLike(sample, value, decimals) + suffix;
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = original;
    }
    requestAnimationFrame(step);
  }

  function scanCounters(root) {
    var nodes = root.querySelectorAll("[data-sb-counter]");
    if (!nodes.length) return;
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < nodes.length; i++) if (!ready(nodes[i])) { markReady(nodes[i]); runCounter(nodes[i]); }
      return;
    }
    if (!state.counterObserver) {
      state.counterObserver = new IntersectionObserver(function (entries) {
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].isIntersecting) {
            runCounter(entries[j].target);
            state.counterObserver.unobserve(entries[j].target);
          }
        }
      }, { threshold: 0.3 });
    }
    for (var k = 0; k < nodes.length; k++) {
      if (ready(nodes[k])) continue;
      markReady(nodes[k]);
      state.counterObserver.observe(nodes[k]);
    }
  }

  /* ---------------------------------------------------------------- */
  /* feedback: popup / toast / snackbar                                 */
  /* ---------------------------------------------------------------- */
  // Full data-sb-* scheme is documented in the editor's widgets.ts. Every
  // open/close goes through openFeedback/closeFeedback so animation,
  // stacking, auto-close, focus handling and screen-reader roles behave the
  // same however the panel was opened (page load, a click/submit trigger, a
  // link's "Opens" toggle). Runtime bookkeeping lives in JS properties
  // (el.__sb*), never in attributes, so none of it is saved into the page
  // by the editor.

  var FEEDBACK_CLOSE_MS = 180;
  var feedbackSeq = 0;

  function isFeedback(el) {
    return !!(el && el.classList && (el.classList.contains("sb-popup") || el.classList.contains("sb-toast") || el.classList.contains("sb-snackbar")));
  }

  function focusablesIn(root) {
    return root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
  }

  // Toast/Snackbar announce themselves to screen readers when shown; an
  // error/warning interrupts (alert), anything else waits politely (status).
  function setLiveRole(el) {
    if (el.classList.contains("sb-popup")) return;
    var v = el.getAttribute("data-sb-variant");
    var urgent = v === "error" || v === "warning" || v === "delete";
    el.setAttribute("role", urgent ? "alert" : "status");
    el.setAttribute("aria-live", urgent ? "assertive" : "polite");
    el.setAttribute("aria-atomic", "true");
  }

  // Toasts sharing a corner stack (newest closest to the edge) instead of
  // drawing on top of each other. --sb-stack is consumed by the translate
  // rules in sb-widgets.css. Snackbars never stack: only one shows at a time.
  function restackFeedback() {
    var nodes = document.querySelectorAll(".sb-toast.sb-open");
    var groups = {};
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (editing() && !n.classList.contains("sb-preview")) continue;
      var pos = n.getAttribute("data-sb-position") || (n.classList.contains("sb-snackbar") ? "bottom-center" : "bottom-right");
      (groups[pos] = groups[pos] || []).push(n);
    }
    for (var key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      var list = groups[key].sort(function (a, b) { return (b.__sbOpenedAt || 0) - (a.__sbOpenedAt || 0); });
      var offset = 0;
      for (var j = 0; j < list.length; j++) {
        list[j].style.setProperty("--sb-stack", offset + "px");
        offset += list[j].offsetHeight + 12;
      }
    }
  }

  function openFeedback(el, opener) {
    el.__sbDismissToken = (el.__sbDismissToken || 0) + 1;
    el.classList.remove("sb-closing");
    if (!el.classList.contains("sb-open")) {
      // One snackbar at a time: a new one replaces whatever is showing.
      if (el.classList.contains("sb-snackbar")) {
        var others = document.querySelectorAll(".sb-snackbar.sb-open");
        for (var o = 0; o < others.length; o++) if (others[o] !== el) closeFeedback(others[o]);
      }
      setLiveRole(el);
      el.classList.add("sb-open");
      el.setAttribute("aria-hidden", "false");
      el.__sbOpenedAt = ++feedbackSeq;
      if (el.classList.contains("sb-popup")) {
        el.__sbReturnFocus = opener || document.activeElement;
        html.classList.add("sb-popup-open");
        var card = el.querySelector(".sb-popup-card") || el;
        if (!card.hasAttribute("tabindex")) card.setAttribute("tabindex", "-1");
        setTimeout(function () {
          var first = focusablesIn(card)[0];
          try { (first || card).focus(); } catch (err) { /* ignore */ }
        }, 30);
      }
    }
    armAutoDismiss(el);
    restackFeedback();
  }

  /* ---------------------------------------------------------------- */
  /* legacy popups captured from the source site                       */
  /* ---------------------------------------------------------------- */
  // Popups, lightboxes, newsletter/promo overlays and cookie banners are
  // captured by the crawler in their OPEN state, but the scripts that closed
  // them were stripped. Here: known plugin markup is recognised by selector,
  // and anything else that looks like an overlay (fixed + covering the page,
  // or a fixed cookie/consent bar) is detected at runtime. Close buttons, the
  // backdrop and Escape hide them, and a dismissed popup stays closed for the
  // rest of the visit (sessionStorage). Runs on the live site only — never
  // inside the editor, so popups stay editable there.
  var LEGACY_MODAL = [
    ".elementor-popup-modal", ".dialog-lightbox-widget", // Elementor
    ".pum-overlay", ".popmake", // Popup Maker
    ".mfp-wrap", ".mfp-bg", // Magnific
    ".modal.show", ".modal.in", ".modal[style*='display: block']", // Bootstrap
    ".fancybox-container", ".fancybox__container", // Fancybox 3/4
    "#colorbox", "#cboxOverlay", // Colorbox
    ".ui-dialog", ".ui-widget-overlay", // jQuery UI
    ".hustle-popup", ".hustle-slidein", // Hustle
    ".et_pb_popup", ".et-pb-popup", // Divi
    ".sqs-popup-overlay", // Squarespace
    ".mc-modal", ".mc-modal-bg", "#mc_embed_signup_popup", // Mailchimp
    ".sgpb-popup-overlay", ".sgpb-popup-dialog-main-div-wrapper", // Popup Builder
    "#cookie-notice", "#cookie-law-info-bar", ".cky-consent-container", ".cky-overlay", "#CybotCookiebotDialog",
    ".cc-window", ".cc-banner", "#onetrust-banner-sdk", "#onetrust-consent-sdk", ".cmplz-cookiebanner", "#moove_gdpr_cookie_info_bar",
    "[aria-modal='true']:not(.sb-popup)", "[data-sb-legacy-modal]"
  ].join(", ");
  var LEGACY_CLOSE = [
    ".dialog-close-button", ".dialog-lightbox-close-button", ".pum-close", ".popmake-close", ".mfp-close",
    "[data-dismiss='modal']", "[data-bs-dismiss='modal']", ".btn-close", ".close", ".close-button", ".modal-close",
    "[data-fancybox-close]", ".fancybox-close-small", ".f-button.is-close-btn", "#cboxClose", ".ui-dialog-titlebar-close",
    ".hustle-button-close", ".sqs-popup-overlay-close", ".mc-closeModal", ".sgpb-popup-close-button-1",
    ".cky-btn-accept", ".cky-btn-reject", ".cky-banner-btn-close", "#cn-accept-cookie", "#cn-close-notice", ".cn-close-icon",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll", "#CybotCookiebotDialogBodyButtonDecline", ".cc-btn", ".cc-dismiss",
    "#onetrust-accept-btn-handler", "#onetrust-reject-all-handler", ".cmplz-btn", "#cookie_action_close_header", ".mgbutton",
    "[aria-label='Close']", "[aria-label='close']", "[aria-label='Close dialog']", "[aria-label='Dismiss']", "[title='Close']",
    "[data-close]", "[data-dismiss]"
  ].join(", ");
  var LEGACY_KEY = "sb-legacy-popup-closed:";
  var OVERLAY_HINT = /popup|pop-up|modal|lightbox|overlay|dialog|newsletter|subscribe|promo|splash|interstitial|optin|opt-in|signup|sign-up|announcement|offer|coupon|welcome|age-gate|agegate/i;
  var COOKIE_HINT = /cookie|consent|gdpr|ccpa|privacy-banner/i;
  var CLOSE_WORDS = /^(?:[×✕✖╳xX]|close|close this|dismiss|no,? thanks?|no thank you|not now|maybe later|skip|continue to site|got it|ok(?:ay)?|accept(?: all)?(?: cookies)?|i accept|agree|i agree|allow(?: all)?|reject(?: all)?|decline)\.?$/i;

  // Every DOM change made here is recorded so it can be undone the moment the
  // visual editor takes over (html[data-sb-editing]) — otherwise a hidden
  // popup or a helper attribute could be saved into the page.
  var legacyTouched = [];
  function touch(el) {
    if (el.__sbLegacyOrig) return;
    el.__sbLegacyOrig = {
      display: el.style.display,
      ariaHidden: el.getAttribute("aria-hidden"),
      role: el.getAttribute("role"),
      cls: el.getAttribute("class"),
      marker: el.getAttribute("data-sb-legacy-modal")
    };
    legacyTouched.push(el);
  }
  function restoreLegacy() {
    for (var i = 0; i < legacyTouched.length; i++) {
      var el = legacyTouched[i];
      var o = el.__sbLegacyOrig;
      if (!o) continue;
      if (o.display) el.style.display = o.display; else el.style.removeProperty("display");
      if (o.ariaHidden === null) el.removeAttribute("aria-hidden"); else el.setAttribute("aria-hidden", o.ariaHidden);
      if (o.role === null) el.removeAttribute("role"); else el.setAttribute("role", o.role);
      if (o.cls === null) el.removeAttribute("class"); else el.setAttribute("class", o.cls);
      if (o.marker === null) el.removeAttribute("data-sb-legacy-modal"); else el.setAttribute("data-sb-legacy-modal", o.marker);
      if (!el.getAttribute("style")) el.removeAttribute("style");
      el.__sbLegacyOrig = null;
      el.__sbOverlayChecked = false;
    }
    legacyTouched = [];
  }
  // Inside an iframe (the editor's preview) a popup is never auto-hidden on
  // load from an earlier dismissal — only closed by an explicit click.
  var inFrame = (function () { try { return window.self !== window.top; } catch (err) { return true; } })();

  function legacyKey(el) {
    return LEGACY_KEY + (el.id || String(el.className || "") || el.tagName || "popup").toString().slice(0, 80);
  }

  function isShown(el) {
    return el.style.display !== "none" && el.getAttribute("aria-hidden") !== "true";
  }

  function classText(el) {
    return (el.id || "") + " " + (typeof el.className === "string" ? el.className : (el.getAttribute && el.getAttribute("class")) || "");
  }

  /** A button/link inside a popup that reads as "close" (✕, "No thanks", "Accept"…). */
  function isCloseLike(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches(LEGACY_CLOSE)) return true;
    var tag = el.tagName;
    var interactive = tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button" || el.hasAttribute("onclick") || el.hasAttribute("tabindex");
    var label = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
    if (label && /^(close|dismiss|close (?:popup|modal|dialog|window|banner))$/i.test(label)) return true;
    var cls = classText(el);
    if (/(^|[\s_-])(close|dismiss|closebtn|close-btn|btn-close|icon-close|popup-close|modal-close)([\s_-]|$)/i.test(cls)) return true;
    if (!interactive) return false;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > 0 && text.length <= 40 && CLOSE_WORDS.test(text);
  }

  /** The close-like element at or above `t`, stopping at `host`. */
  function closeTarget(t, host) {
    var el = t;
    while (el && el.nodeType === 1) {
      if (isCloseLike(el)) return el;
      if (el === host) return null;
      el = el.parentElement;
    }
    return null;
  }

  // Overlays built without a known plugin: a fixed/absolute layer covering
  // most of the viewport with a popup-ish name, or a fixed cookie bar.
  function detectOverlays(root) {
    if (!window.getComputedStyle) return;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var nodes = root.querySelectorAll("div, section, aside, dialog, form");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__sbOverlayChecked || el.hasAttribute("data-sb-legacy-modal") || isFeedback(el)) continue;
      el.__sbOverlayChecked = true;
      var hint = classText(el) + " " + (el.getAttribute("role") || "");
      var cookie = COOKIE_HINT.test(hint);
      if (!cookie && !OVERLAY_HINT.test(hint) && el.tagName !== "DIALOG") continue;
      if (closest(el.parentElement, "[data-sb-legacy-modal], " + LEGACY_MODAL)) continue; // inside one already
      if (closest(el, "header, nav, .sb-popup, .sb-toast, .sb-snackbar, #sb-a11y-root, .sb-a11y")) continue;
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (cs.position !== "fixed" && !(cs.position === "absolute" && el.tagName === "DIALOG")) continue;
      var r = el.getBoundingClientRect();
      var covers = r.width >= vw * 0.5 && r.height >= vh * 0.5;
      var bar = cookie && r.width >= vw * 0.3;
      if (!covers && !bar) continue;
      // Only something the visitor can actually dismiss — never a decorative
      // fixed background layer.
      var parts = el.querySelectorAll("a, button, [role='button'], [onclick], [tabindex], span, i, svg, div");
      var closable = false;
      for (var k = 0; k < parts.length && !closable; k++) if (isCloseLike(parts[k])) closable = true;
      if (!closable) continue;
      touch(el);
      el.setAttribute("data-sb-legacy-modal", cookie ? "cookie" : "overlay");
    }
  }

  function hideLegacyModal(el, remember) {
    touch(el);
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
    el.classList.remove("show", "in", "pum-active", "mfp-ready", "is-open", "open", "active", "visible");
    if (el.tagName === "DIALOG" && el.close) { try { el.close(); } catch (err) { /* ignore */ } }
    // Plugins pair the dialog with a separate backdrop element — hide it too.
    var BACKDROP = ".mfp-bg, #cboxOverlay, .ui-widget-overlay, .modal-backdrop, .mc-modal-bg, .cky-overlay, .sgpb-popup-overlay";
    var sibs = [el.previousElementSibling, el.nextElementSibling];
    for (var s2 = 0; s2 < sibs.length; s2++) {
      if (sibs[s2] && sibs[s2].matches(BACKDROP)) {
        touch(sibs[s2]);
        sibs[s2].style.display = "none";
      }
    }
    var backdrops = document.querySelectorAll(".mfp-bg, #cboxOverlay, .ui-widget-overlay, .modal-backdrop, .mc-modal-bg, .cky-overlay, .sgpb-popup-overlay");
    var anyOpen = false;
    var open = document.querySelectorAll(LEGACY_MODAL);
    for (var i = 0; i < open.length; i++) if (isShown(open[i]) && !open[i].matches(".mfp-bg, #cboxOverlay, .ui-widget-overlay, .mc-modal-bg, .cky-overlay, .sgpb-popup-overlay")) anyOpen = true;
    if (!anyOpen) {
      for (var b = 0; b < backdrops.length; b++) {
        touch(backdrops[b]);
        backdrops[b].style.display = "none";
      }
      var locks = ["dialog-prevent-scroll", "modal-open", "pum-open", "pum-open-overlay", "mfp-zoom-out-cur", "fancybox-active", "compensate-for-scrollbar", "overflow-hidden", "no-scroll", "noscroll", "popup-open", "sqs-popup-overlay-open"];
      for (var j = 0; j < locks.length; j++) {
        document.body.classList.remove(locks[j]);
        html.classList.remove(locks[j]);
      }
      document.body.style.removeProperty("overflow");
      html.style.removeProperty("overflow");
    }
    if (remember) {
      try { window.sessionStorage.setItem(legacyKey(el), "1"); } catch (err) { /* private mode */ }
    }
  }

  function scanLegacyModals(root) {
    if (editing() || !root || !root.querySelectorAll) return;
    detectOverlays(root);
    var modals = root.querySelectorAll(LEGACY_MODAL);
    for (var i = 0; i < modals.length; i++) {
      var m = modals[i];
      if (closest(m.parentElement, LEGACY_MODAL)) continue; // nested part of an outer popup
      var closed = false;
      try { closed = window.sessionStorage.getItem(legacyKey(m)) === "1"; } catch (err) { /* ignore */ }
      if (closed && !inFrame) hideLegacyModal(m, false);
      else if (m.getAttribute("data-sb-legacy-modal") !== "cookie" && (!m.hasAttribute("role") || m.getAttribute("role") === "document")) {
        touch(m);
        m.setAttribute("role", "dialog");
      }
    }
  }

  function topLegacyModal() {
    var modals = document.querySelectorAll(LEGACY_MODAL);
    for (var i = modals.length - 1; i >= 0; i--) {
      if (isShown(modals[i]) && modals[i].getAttribute("data-sb-legacy-modal") !== "cookie" && !closest(modals[i].parentElement, LEGACY_MODAL)) return modals[i];
    }
    return null;
  }

  /** Handles a click inside a captured popup; true when it closed one. */
  function legacyClick(e, t) {
    var host = closest(t, LEGACY_MODAL);
    if (!host) return false;
    // Use the outermost popup wrapper so the whole thing (and its backdrop) goes.
    var outer = host;
    var up = outer.parentElement ? closest(outer.parentElement, LEGACY_MODAL) : null;
    while (up) { outer = up; up = outer.parentElement ? closest(outer.parentElement, LEGACY_MODAL) : null; }
    var btn = closeTarget(t, outer);
    var backdrop = !btn && (t === host || t === outer || /(^|[\s_-])(overlay|backdrop|mfp-bg|cboxOverlay)([\s_-]|$)/i.test(classText(t)));
    if (!btn && !backdrop) return false;
    var href = btn && btn.tagName === "A" ? btn.getAttribute("href") : null;
    if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href)) e.preventDefault();
    hideLegacyModal(outer, true);
    return true;
  }

  function closeFeedback(el) {
    if (!el.classList.contains("sb-open") || el.classList.contains("sb-closing")) return;
    var token = (el.__sbDismissToken = (el.__sbDismissToken || 0) + 1);
    function finish() {
      if (el.__sbDismissToken !== token) return; // reopened meanwhile
      el.classList.remove("sb-open");
      el.classList.remove("sb-closing");
      el.classList.remove("sb-timed");
      el.classList.remove("sb-paused");
      el.setAttribute("aria-hidden", "true");
      el.style.removeProperty("--sb-stack");
      el.style.removeProperty("--sb-life");
      if (el.classList.contains("sb-popup")) {
        if (!document.querySelector(".sb-popup.sb-open")) html.classList.remove("sb-popup-open");
        var back = el.__sbReturnFocus;
        el.__sbReturnFocus = null;
        if (back && back.focus && document.documentElement.contains(back)) {
          try { back.focus(); } catch (err) { /* ignore */ }
        }
      }
      restackFeedback();
    }
    if (reduced()) { finish(); return; }
    el.classList.add("sb-closing");
    setTimeout(finish, FEEDBACK_CLOSE_MS);
  }

  // Auto-close after data-sb-autodismiss ms. The countdown (and the progress
  // bar drawn from --sb-life) pauses while the pointer or keyboard focus is
  // inside, so nobody loses a message they are reading (WCAG 2.2.1).
  function armAutoDismiss(el) {
    var ms = parseInt(el.getAttribute("data-sb-autodismiss"), 10);
    el.classList.remove("sb-paused");
    if (!ms || ms <= 0) { el.classList.remove("sb-timed"); return; }
    var token = el.__sbDismissToken;
    var remaining = ms;
    var started = 0;
    var timer = null;
    function run() {
      started = Date.now();
      timer = setTimeout(function () {
        timer = null;
        if (el.__sbDismissToken === token) closeFeedback(el);
      }, remaining);
    }
    el.__sbPause = function () {
      if (el.__sbDismissToken !== token || !timer) return;
      clearTimeout(timer);
      timer = null;
      remaining -= Date.now() - started;
      el.classList.add("sb-paused");
    };
    el.__sbResume = function () {
      if (el.__sbDismissToken !== token || timer) return;
      var hovered = false;
      try { hovered = el.matches(":hover"); } catch (err) { /* ignore */ }
      if (hovered || el.contains(document.activeElement)) return;
      el.classList.remove("sb-paused");
      run();
    };
    if (!el.__sbPauseBound) {
      el.__sbPauseBound = true;
      el.addEventListener("mouseenter", function () { if (el.__sbPause) el.__sbPause(); });
      el.addEventListener("mouseleave", function () { if (el.__sbResume) el.__sbResume(); });
      el.addEventListener("focusin", function () { if (el.__sbPause) el.__sbPause(); });
      el.addEventListener("focusout", function () { setTimeout(function () { if (el.__sbResume) el.__sbResume(); }, 0); });
    }
    // Restart the progress bar animation from full.
    el.style.setProperty("--sb-life", ms + "ms");
    el.classList.remove("sb-timed");
    void el.offsetWidth;
    el.classList.add("sb-timed");
    run();
  }

  // data-sb-frequency "once" = at most once per browser session (checked via
  // sessionStorage); "always" = every time the trigger fires. Delay applies
  // to every trigger type.
  function openFeedbackNode(el, opener) {
    if (editing()) return;
    var remember = el.getAttribute("data-sb-frequency") !== "always";
    var key = "sbShown:" + (el.id || "default");
    if (remember) {
      try {
        if (window.sessionStorage && window.sessionStorage.getItem(key)) return;
      } catch (err) { /* storage blocked (private mode) — show it anyway */ }
    }
    var delay = parseInt(el.getAttribute("data-sb-delay"), 10) || 0;
    setTimeout(function () {
      openFeedback(el, opener);
      if (remember) {
        try { if (window.sessionStorage) window.sessionStorage.setItem(key, "1"); } catch (err) { /* ignore */ }
      }
    }, delay);
  }

  // data-sb-trigger="load": opens itself when the page loads.
  function scanFeedbackAutoOpen(root) {
    var nodes = root.querySelectorAll('[data-sb-trigger="load"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (ready(el)) continue;
      markReady(el);
      if (editing()) continue;
      openFeedbackNode(el, null);
    }
  }

  function resolveTriggerSource(sel) {
    if (!sel) return null;
    if (sel.charAt(0) === "#") {
      var byId = document.getElementById(sel.slice(1));
      if (byId) return byId;
    }
    try { return document.querySelector(sel); } catch (err) { return null; }
  }

  // data-sb-trigger="click"|"submit" + data-sb-trigger-target="#id": opens
  // when that button/link is clicked or that form is submitted, alongside
  // whatever the element normally does. Re-binds if the target changes.
  function scanTriggeredFeedback(root) {
    var nodes = root.querySelectorAll('[data-sb-trigger="click"], [data-sb-trigger="submit"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // Marker written into saved pages by an earlier build — it made the
      // live site think the trigger was already wired. Harmless to drop.
      if (el.hasAttribute("data-sb-ready-trigger")) el.removeAttribute("data-sb-ready-trigger");
      var kind = el.getAttribute("data-sb-trigger");
      var sel = el.getAttribute("data-sb-trigger-target") || "";
      var bindKey = kind + "|" + sel;
      var bound = el.__sbTrigger;
      if (bound && bound.key === bindKey && document.documentElement.contains(bound.src)) continue;
      if (bound) bound.src.removeEventListener(bound.type, bound.fn, false);
      el.__sbTrigger = null;
      var src = resolveTriggerSource(sel);
      if (!src) continue;
      var type = kind === "submit" ? "submit" : "click";
      var fn = (function (node, isSubmit, source) {
        return function (e) {
          if (editing()) return;
          if (isSubmit && node.hasAttribute("data-sb-prevent-default")) e.preventDefault();
          if (!isSubmit && source.tagName === "A") {
            var href = source.getAttribute("href");
            if (!href || href === "#") e.preventDefault(); // placeholder link: don't jump to top
          }
          openFeedbackNode(node, source);
        };
      })(el, type === "submit", src);
      src.addEventListener(type, fn, false);
      el.__sbTrigger = { key: bindKey, src: src, type: type, fn: fn };
    }
  }

  /* ---------------------------------------------------------------- */
  /* sliders                                                            */
  /* ---------------------------------------------------------------- */

  function Slider(container) {
    var self = this;
    this.el = container;
    try { this.opts = JSON.parse(container.getAttribute("data-sb-slider") || "{}"); } catch (e) { this.opts = {}; }
    this.classMode = container.getAttribute("data-sb-slider-mode") === "class";
    this.track = container.querySelector("[data-sb-track]");
    this.viewport = container.querySelector("[data-sb-viewport]") || this.track;
    this.slides = [];
    this.index = 0;
    this.timer = null;
    this.hover = false;
    this.dots = [];
    if (!this.track) return;
    this.collectSlides();
    if (this.slides.length < 2) return;
    this.effect = this.classMode ? "class" : (this.opts.effect === "fade" ? "fade" : "slide");
    if (!this.classMode) container.setAttribute("data-sb-effect", this.effect);
    this.buildDots();
    var prev = container.querySelector("[data-sb-prev]") || sibling(container, "[data-sb-prev]");
    var next = container.querySelector("[data-sb-next]") || sibling(container, "[data-sb-next]");
    this.prevBtn = prev;
    this.nextBtn = next;
    if (prev) prev.addEventListener("click", function (e) { e.preventDefault(); self.go(self.index - self.step(), true); });
    if (next) next.addEventListener("click", function (e) { e.preventDefault(); self.go(self.index + self.step(), true); });
    // WCAG 2.2.2: autoplay pauses while the pointer or keyboard focus is inside.
    container.addEventListener("mouseenter", function () { self.hover = true; });
    container.addEventListener("mouseleave", function () { self.hover = false; });
    container.addEventListener("focusin", function () { self.focused = true; self.setLive(); });
    container.addEventListener("focusout", function (e) {
      if (!container.contains(e.relatedTarget)) { self.focused = false; self.setLive(); }
    });
    container.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); self.go(self.index - 1, true); }
      else if (e.key === "ArrowRight") { e.preventDefault(); self.go(self.index + 1, true); }
    });
    this.applyAria();
    this.bindSwipe();
    this.layout();
    // Start at whatever slide the source marked active, else the first.
    var active = -1;
    for (var i = 0; i < this.slides.length; i++) {
      if (/(^|\s)(active|sb-active|swiper-slide-active|slick-current)(\s|$)/.test(this.slides[i].className)) { active = i; break; }
    }
    this.go(active >= 0 ? active : 0, false);
    this.startAutoplay();
    if ("IntersectionObserver" in window) {
      this.visible = true;
      this.io = new IntersectionObserver(function (entries) { self.visible = entries[0].isIntersecting; }, { threshold: 0.1 });
      this.io.observe(container);
    } else {
      this.visible = true;
    }
  }

  function sibling(container, selector) {
    var parent = container.parentElement;
    for (var depth = 0; parent && depth < 3; depth++) {
      var found = parent.querySelector(selector);
      if (found) return found;
      parent = parent.parentElement;
    }
    return null;
  }

  Slider.prototype.collectSlides = function () {
    var kids = this.track.children;
    this.slides = [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].hasAttribute("data-sb-slide") || (this.classMode && kids[i].classList.contains("carousel-item"))) {
        this.slides.push(kids[i]);
      }
    }
  };

  // Carousel semantics (WAI-ARIA APG): region + roledescription, labelled
  // controls, slides as groups, live region only while not auto-rotating.
  Slider.prototype.applyAria = function () {
    var el = this.el;
    if (!el.getAttribute("role")) el.setAttribute("role", "region");
    if (!el.hasAttribute("aria-roledescription")) el.setAttribute("aria-roledescription", "carousel");
    if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) el.setAttribute("aria-label", "Carousel");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    for (var i = 0; i < this.slides.length; i++) {
      var s = this.slides[i];
      if (!s.getAttribute("role")) s.setAttribute("role", "group");
      if (!s.hasAttribute("aria-roledescription")) s.setAttribute("aria-roledescription", "slide");
      if (!s.hasAttribute("aria-label") && !s.hasAttribute("aria-labelledby")) s.setAttribute("aria-label", (i + 1) + " of " + this.slides.length);
    }
    labelControl(this.prevBtn, "Previous slide");
    labelControl(this.nextBtn, "Next slide");
    if (this.dotsEl) {
      if (!this.dotsEl.getAttribute("role")) this.dotsEl.setAttribute("role", "group");
      if (!this.dotsEl.hasAttribute("aria-label")) this.dotsEl.setAttribute("aria-label", "Choose slide");
    }
    this.setLive();
  };

  Slider.prototype.setLive = function () {
    var rotating = !!this.timer && !this.hover && !this.focused;
    this.track.setAttribute("aria-live", rotating ? "off" : "polite");
  };

  function labelControl(btn, label) {
    if (!btn) return;
    if (btn.tagName !== "BUTTON" && btn.tagName !== "A") {
      if (!btn.getAttribute("role")) btn.setAttribute("role", "button");
      if (!btn.hasAttribute("tabindex")) btn.setAttribute("tabindex", "0");
    }
    var hasName = btn.hasAttribute("aria-label") || btn.hasAttribute("aria-labelledby") || (btn.textContent || "").trim().length > 1;
    if (!hasName) btn.setAttribute("aria-label", label);
  }

  Slider.prototype.perView = function () {
    if (this.effect !== "slide") return 1;
    var w = window.innerWidth;
    var n = w <= MOBILE ? this.opts.perViewMobile : w <= TABLET ? this.opts.perViewTablet : this.opts.perView;
    n = parseInt(n, 10);
    if (!n || n < 1) n = 1;
    return Math.min(n, this.slides.length);
  };

  Slider.prototype.step = function () { return 1; };

  Slider.prototype.layout = function () {
    var n = this.perView();
    var gap = parseFloat(this.opts.gap) || 0;
    var speed = parseInt(this.opts.speed, 10) || 500;
    this.el.style.setProperty("--sb-gap", gap + "px");
    this.el.style.setProperty("--sb-speed", speed + "ms");
    if (this.effect === "slide") {
      this.el.style.setProperty("--sb-slide-basis", n === 1 && gap === 0 ? "100%" : "calc((100% - " + (gap * (n - 1)) + "px) / " + n + ")");
    } else {
      this.el.style.setProperty("--sb-slide-basis", "100%");
    }
    this.maxIndex = Math.max(0, this.slides.length - n);
    this.refreshDots();
  };

  Slider.prototype.buildDots = function () {
    var dotsEl = this.el.querySelector("[data-sb-dots]") || sibling(this.el, "[data-sb-dots]");
    this.dotsEl = dotsEl;
    if (!dotsEl) return;
    var isBullet = dotsEl.classList.contains("swiper-pagination");
    var isSlick = dotsEl.classList.contains("slick-dots");
    dotsEl.innerHTML = "";
    this.dots = [];
    var self = this;
    for (var i = 0; i < this.slides.length; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sb-dot" + (isBullet ? " swiper-pagination-bullet" : "") + (dotsEl.classList.contains("owl-dots") ? " owl-dot" : "");
      btn.setAttribute("aria-label", "Go to slide " + (i + 1));
      btn.textContent = String(i + 1);
      (function (idx) {
        btn.addEventListener("click", function (e) { e.preventDefault(); self.go(idx, true); });
      })(i);
      if (isSlick) {
        var li = document.createElement("li");
        li.appendChild(btn);
        dotsEl.appendChild(li);
      } else {
        dotsEl.appendChild(btn);
      }
      this.dots.push(btn);
    }
  };

  Slider.prototype.refreshDots = function () {
    if (!this.dots.length) return;
    var visibleDots = this.effect === "slide" ? this.maxIndex + 1 : this.slides.length;
    for (var i = 0; i < this.dots.length; i++) {
      var wrapper = this.dots[i].parentElement && this.dots[i].parentElement.tagName === "LI" ? this.dots[i].parentElement : this.dots[i];
      wrapper.style.display = i < visibleDots ? "" : "none";
    }
  };

  Slider.prototype.go = function (index, user) {
    var count = this.effect === "slide" ? this.maxIndex + 1 : this.slides.length;
    if (count < 1) count = 1;
    var loop = this.opts.loop !== false;
    if (index < 0) index = loop ? count - 1 : 0;
    if (index > count - 1) index = loop ? 0 : count - 1;
    this.index = index;
    var i;
    if (this.effect === "slide") {
      var target = this.slides[index];
      var offset = target ? target.offsetLeft : 0;
      this.track.style.transform = "translate3d(" + (-offset) + "px, 0, 0)";
    }
    for (i = 0; i < this.slides.length; i++) {
      var s = this.slides[i];
      var on = this.effect === "slide" ? i >= index && i < index + this.perView() : i === index;
      s.classList.toggle("sb-active", on);
      if (this.classMode) s.classList.toggle("active", i === index);
      s.classList.toggle("swiper-slide-active", i === index);
      s.classList.toggle("slick-active", on);
      s.classList.toggle("slick-current", i === index);
      if (!this.classMode) s.setAttribute("aria-hidden", on ? "false" : "true");
    }
    for (i = 0; i < this.dots.length; i++) {
      var dotOn = i === index;
      this.dots[i].classList.toggle("sb-active", dotOn);
      this.dots[i].classList.toggle("swiper-pagination-bullet-active", dotOn);
      if (dotOn) this.dots[i].setAttribute("aria-current", "true"); else this.dots[i].removeAttribute("aria-current");
      var li = this.dots[i].parentElement;
      if (li && li.tagName === "LI") li.classList.toggle("slick-active", dotOn);
    }
    if (!loop) {
      if (this.prevBtn) { this.prevBtn.classList.toggle("sb-disabled", index === 0); this.prevBtn.setAttribute("aria-disabled", index === 0 ? "true" : "false"); }
      if (this.nextBtn) { this.nextBtn.classList.toggle("sb-disabled", index >= count - 1); this.nextBtn.setAttribute("aria-disabled", index >= count - 1 ? "true" : "false"); }
    }
    if (user) this.startAutoplay();
  };

  Slider.prototype.startAutoplay = function () {
    var self = this;
    this.stopAutoplay();
    var every = parseInt(this.opts.autoplay, 10) || 0;
    if (!every || reduced() || editing()) { this.setLive(); return; }
    this.timer = setInterval(function () {
      if (self.visible === false) return;
      if (self.hover && self.opts.pauseOnHover !== false) return;
      if (self.focused) return;
      if (document.hidden) return;
      self.go(self.index + 1, false);
    }, Math.max(1200, every));
    this.setLive();
  };

  Slider.prototype.stopAutoplay = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.track) this.setLive();
  };

  Slider.prototype.bindSwipe = function () {
    var self = this;
    var startX = null;
    var startY = null;
    var area = this.viewport || this.el;
    area.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY;
    });
    area.addEventListener("pointerup", function (e) {
      if (startX === null) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      startX = startY = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      self.go(self.index + (dx < 0 ? 1 : -1), true);
    });
    area.addEventListener("pointercancel", function () { startX = startY = null; });
  };

  Slider.prototype.destroy = function () {
    this.stopAutoplay();
    if (this.io) this.io.disconnect();
  };

  function scanSliders(root) {
    var nodes = root.querySelectorAll("[data-sb-slider]");
    for (var i = 0; i < nodes.length; i++) {
      if (ready(nodes[i])) continue;
      markReady(nodes[i]);
      state.sliders.push(new Slider(nodes[i]));
    }
  }

  /* ---------------------------------------------------------------- */
  /* parallax                                                           */
  /* ---------------------------------------------------------------- */

  function scanParallax(root) {
    if (reduced()) return;
    var nodes = root.querySelectorAll("[data-sb-parallax], [data-sb-parallax-bg]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__sbParallax) continue;
      el.__sbParallax = true;
      state.parallax.push(el);
    }
    if (state.parallax.length && !state.scrollBound) {
      state.scrollBound = true;
      window.addEventListener("scroll", requestParallax, { passive: true });
      window.addEventListener("resize", requestParallax);
    }
    requestParallax();
  }

  function requestParallax() {
    if (state.rafPending) return;
    state.rafPending = true;
    requestAnimationFrame(function () {
      state.rafPending = false;
      if (editing() || reduced()) return;
      var vh = window.innerHeight || 1;
      for (var i = 0; i < state.parallax.length; i++) {
        var el = state.parallax[i];
        if (!el.isConnected) continue;
        var rect = el.getBoundingClientRect();
        if (rect.bottom < -vh || rect.top > vh * 2) continue;
        var offset = rect.top + rect.height / 2 - vh / 2;
        var speed = parseFloat(el.getAttribute("data-sb-parallax"));
        if (isFinite(speed) && speed !== 0) {
          var ty = Math.max(-rect.height, Math.min(rect.height, -offset * speed));
          el.style.transform = "translate3d(0," + ty.toFixed(1) + "px,0)";
        }
        var bg = parseFloat(el.getAttribute("data-sb-parallax-bg"));
        if (isFinite(bg) && bg !== 0) {
          el.style.backgroundPositionY = "calc(50% + " + (offset * bg).toFixed(1) + "px)";
        }
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* clicks: toggles, menus, accordions, tabs, anchors                  */
  /* ---------------------------------------------------------------- */

  function closest(el, selector) {
    while (el && el.nodeType === 1) {
      if (el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function resolveTarget(trigger, attr) {
    var value = trigger.getAttribute(attr);
    if (!value) return null;
    try { return document.querySelector(value); } catch (e) { return null; }
  }

  function toggleWithClass(trigger, target, cls) {
    // Popup/Toast/Snackbar go through the shared open/close path (animation,
    // stacking, focus, auto-close) instead of a bare class flip.
    if (cls === "sb-open" && isFeedback(target)) {
      var willOpen = !target.classList.contains("sb-open") || target.classList.contains("sb-closing");
      if (willOpen) openFeedback(target, trigger); else closeFeedback(target);
      trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      return willOpen;
    }
    var open = target.classList.toggle(cls);
    if (cls !== "sb-open") target.classList.toggle("sb-open", open);
    trigger.classList.toggle("sb-open", open);
    trigger.classList.toggle("elementor-active", open);
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
    target.setAttribute("aria-hidden", open ? "false" : "true");
    if (target.style.display === "none") target.style.display = "";
    if (open) armAutoDismiss(target);
    else target.__sbDismissToken = (target.__sbDismissToken || 0) + 1; // cancel a pending timer
    return open;
  }

  function onClick(e) {
    if (editing()) return;
    if (e.defaultPrevented) return;
    var t = e.target;
    if (!t || t.nodeType !== 1) return;

    // Close button / backdrop on a Popup, Toast or Snackbar (data-sb-dismiss).
    var dismiss = closest(t, "[data-sb-dismiss]");
    if (dismiss) {
      var dismissHost = closest(dismiss, ".sb-popup, .sb-toast, .sb-snackbar");
      if (dismissHost) {
        // A snackbar action pointed at a real page still navigates; it just
        // closes the snackbar on the way. Placeholder "#" links don't jump.
        var dismissHref = dismiss.tagName === "A" ? dismiss.getAttribute("href") : null;
        if (!dismissHref || dismissHref === "#") e.preventDefault();
        closeFeedback(dismissHost);
        return;
      }
    }

    // Close button or backdrop of a popup captured from the source site.
    if (legacyClick(e, t)) return;

    // Explicit toggles written at clone time (hamburgers, Bootstrap collapse).
    var toggle = closest(t, "[data-sb-toggle]");
    if (toggle) {
      var target = resolveTarget(toggle, "data-sb-toggle");
      if (target) {
        e.preventDefault();
        toggleWithClass(toggle, target, toggle.getAttribute("data-sb-toggle-class") || "sb-open");
        return;
      }
    }

    // Elementor mobile menu button.
    var menuToggle = closest(t, ".elementor-menu-toggle");
    if (menuToggle) {
      var widget = closest(menuToggle, ".elementor-widget-nav-menu, .elementor-widget-container, .elementor-widget") || menuToggle.parentElement;
      var dropdown = widget ? widget.querySelector(".elementor-nav-menu--dropdown") : null;
      if (dropdown) {
        e.preventDefault();
        var isOpen = toggleWithClass(menuToggle, dropdown, "sb-open");
        dropdown.classList.toggle("elementor-nav-menu--active", isOpen);
        // Elementor collapses the panel with max-height: var(--menu-height).
        if (isOpen) {
          var stretchWidget = closest(menuToggle, ".elementor-nav-menu--stretch");
          if (stretchWidget) {
            var wr = stretchWidget.getBoundingClientRect();
            dropdown.style.width = document.documentElement.clientWidth + "px";
            dropdown.style.left = (-wr.left) + "px";
            var tr = menuToggle.getBoundingClientRect();
            dropdown.style.top = (tr.bottom - wr.top) + "px";
          }
          dropdown.style.setProperty("--menu-height", dropdown.scrollHeight + "px");
          dropdown.style.maxHeight = dropdown.scrollHeight + "px";
        } else {
          dropdown.style.setProperty("--menu-height", "0");
          dropdown.style.maxHeight = "";
        }
        return;
      }
    }

    // Elementor dropdown sub-menus (tap the arrow or the parent link).
    var subArrow = closest(t, ".elementor-nav-menu--dropdown .menu-item-has-children > a, .elementor-nav-menu--dropdown .sub-arrow");
    if (subArrow) {
      var link = subArrow.tagName === "A" ? subArrow : closest(subArrow, "a");
      var li = link ? link.parentElement : null;
      var sub = li ? li.querySelector(":scope > ul, :scope > .sub-menu") : null;
      var href = link ? link.getAttribute("href") || "" : "";
      var arrowHit = closest(t, ".sub-arrow") !== null;
      if (sub && (arrowHit || !href || href === "#")) {
        e.preventDefault();
        var subOpen = sub.classList.toggle("sb-open");
        li.classList.toggle("elementor-active", subOpen);
        link.classList.toggle("elementor-active", subOpen);
        link.classList.toggle("highlighted", subOpen);
        link.setAttribute("aria-expanded", subOpen ? "true" : "false");
        return;
      }
    }

    // Elementor accordion / toggle.
    var accTitle = closest(t, ".elementor-accordion .elementor-tab-title, .elementor-toggle .elementor-tab-title");
    if (accTitle) {
      e.preventDefault();
      var item = closest(accTitle, ".elementor-accordion-item, .elementor-toggle-item") || accTitle.parentElement;
      var content = item ? item.querySelector(".elementor-tab-content") : null;
      var isAccordion = closest(accTitle, ".elementor-accordion") !== null;
      var willOpen = !accTitle.classList.contains("elementor-active");
      if (isAccordion) {
        var widgetRoot = closest(accTitle, ".elementor-accordion");
        var titles = widgetRoot.querySelectorAll(".elementor-tab-title");
        var contents = widgetRoot.querySelectorAll(".elementor-tab-content");
        for (var i = 0; i < titles.length; i++) { titles[i].classList.remove("elementor-active"); titles[i].setAttribute("aria-expanded", "false"); }
        for (var j = 0; j < contents.length; j++) { contents[j].classList.remove("elementor-active"); contents[j].style.display = ""; }
      }
      accTitle.classList.toggle("elementor-active", willOpen);
      accTitle.setAttribute("aria-expanded", willOpen ? "true" : "false");
      if (content) { content.classList.toggle("elementor-active", willOpen); content.style.display = ""; }
      return;
    }

    // Elementor tabs.
    var tabTitle = closest(t, ".elementor-tabs .elementor-tab-title[data-tab]");
    if (tabTitle) {
      e.preventDefault();
      var tabs = closest(tabTitle, ".elementor-tabs");
      var n = tabTitle.getAttribute("data-tab");
      var all = tabs.querySelectorAll(".elementor-tab-title, .elementor-tab-content");
      for (var k = 0; k < all.length; k++) {
        var on = all[k].getAttribute("data-tab") === n;
        all[k].classList.toggle("elementor-active", on);
        if (all[k].classList.contains("elementor-tab-content")) all[k].style.display = "";
        else if (closest(all[k], ".elementor-tabs-wrapper")) { all[k].setAttribute("aria-selected", on ? "true" : "false"); all[k].setAttribute("tabindex", on ? "0" : "-1"); }
      }
      return;
    }

    // Bootstrap tabs.
    var bsTab = closest(t, "[data-bs-toggle='tab'], [data-toggle='tab'], [data-bs-toggle='pill'], [data-toggle='pill']");
    if (bsTab) {
      var pane = resolveTarget(bsTab, "data-bs-target") || resolveTarget(bsTab, "data-target") || (bsTab.getAttribute("href") && bsTab.getAttribute("href")[0] === "#" ? document.querySelector(bsTab.getAttribute("href")) : null);
      if (pane) {
        e.preventDefault();
        var nav = closest(bsTab, ".nav, .nav-tabs, .nav-pills, ul, [role='tablist']");
        if (nav) {
          var links = nav.querySelectorAll(".nav-link, [data-bs-toggle], [data-toggle]");
          for (var m = 0; m < links.length; m++) { links[m].classList.remove("active"); links[m].setAttribute("aria-selected", "false"); }
        }
        bsTab.classList.add("active");
        bsTab.setAttribute("aria-selected", "true");
        var container = pane.parentElement;
        if (container) {
          for (var p = 0; p < container.children.length; p++) container.children[p].classList.remove("active", "show");
        }
        pane.classList.add("active", "show");
        return;
      }
    }

    // Generic WordPress / theme hamburgers without explicit targets.
    var hamburger = closest(t, ".menu-toggle, .navbar-toggler, .navbar-toggle, .mobile-menu-toggle, .hamburger, .nav-toggle");
    if (hamburger && !hamburger.hasAttribute("data-sb-toggle")) {
      var scope = hamburger.parentElement;
      var panel = null;
      for (var d = 0; scope && d < 4 && !panel; d++) {
        panel = scope.querySelector(".navbar-collapse, .menu-container, .nav-menu, .primary-menu, nav ul, .menu");
        scope = scope.parentElement;
      }
      if (panel) {
        e.preventDefault();
        toggleWithClass(hamburger, panel, "sb-open");
        panel.classList.toggle("show", panel.classList.contains("sb-open"));
        panel.classList.toggle("toggled", panel.classList.contains("sb-open"));
        return;
      }
    }

    // Anchor links: smooth scroll / back to top.
    var a = closest(t, "a[href]");
    if (a) {
      var h = a.getAttribute("href") || "";
      if (h === "#" || /back-to-top|scroll-top|scrolltop|to-top|go-top/i.test(a.className + " " + a.id)) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
        return;
      }
      if (h.length > 1 && h[0] === "#") {
        var dest = null;
        try { dest = document.querySelector(h); } catch (err) { dest = null; }
        if (dest) {
          e.preventDefault();
          dest.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
          if (history.replaceState) history.replaceState(null, "", h);
          // Move keyboard focus with the scroll (WCAG 2.4.3 focus order).
          if (!dest.hasAttribute("tabindex")) dest.setAttribute("tabindex", "-1");
          dest.focus({ preventScroll: true });
        }
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* ARIA for toggles / accordions / tabs (added only where missing)    */
  /* ---------------------------------------------------------------- */

  var idSeq = 0;
  function ensureId(el, prefix) {
    if (!el.id) el.id = prefix + "-" + (++idSeq) + "-" + Math.random().toString(36).slice(2, 6);
    return el.id;
  }

  function makeFocusable(el) {
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName) && !(el.tagName === "A" && !el.hasAttribute("href"))) return;
    if (!el.getAttribute("role")) el.setAttribute("role", "button");
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
  }

  function scanAria(root) {
    var i, j, el, target, panel;

    // Explicit toggles + hamburgers.
    var toggles = root.querySelectorAll("[data-sb-toggle], .elementor-menu-toggle, .menu-toggle, .navbar-toggler, .navbar-toggle, .mobile-menu-toggle, .hamburger, .nav-toggle");
    for (i = 0; i < toggles.length; i++) {
      el = toggles[i];
      if (el.__sbAria) continue;
      el.__sbAria = true;
      makeFocusable(el);
      if (!el.hasAttribute("aria-expanded")) el.setAttribute("aria-expanded", el.classList.contains("sb-open") || el.classList.contains("elementor-active") ? "true" : "false");
      target = el.hasAttribute("data-sb-toggle") ? resolveTarget(el, "data-sb-toggle") : null;
      if (target && !el.hasAttribute("aria-controls")) el.setAttribute("aria-controls", ensureId(target, "sb-panel"));
      if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby") && !(el.textContent || "").trim()) el.setAttribute("aria-label", "Menu");
    }

    // Elementor accordion / toggle widgets.
    var accTitles = root.querySelectorAll(".elementor-accordion .elementor-tab-title, .elementor-toggle .elementor-tab-title");
    for (i = 0; i < accTitles.length; i++) {
      el = accTitles[i];
      if (el.__sbAria) continue;
      el.__sbAria = true;
      makeFocusable(el);
      var item = closest(el, ".elementor-accordion-item, .elementor-toggle-item") || el.parentElement;
      panel = item ? item.querySelector(".elementor-tab-content") : null;
      var open = el.classList.contains("elementor-active");
      if (!el.hasAttribute("aria-expanded")) el.setAttribute("aria-expanded", open ? "true" : "false");
      if (panel) {
        if (!el.hasAttribute("aria-controls")) el.setAttribute("aria-controls", ensureId(panel, "sb-acc"));
        if (!panel.getAttribute("role")) panel.setAttribute("role", "region");
        if (!panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", ensureId(el, "sb-acc-title"));
      }
    }

    // Elementor tabs.
    var tabWidgets = root.querySelectorAll(".elementor-tabs");
    for (i = 0; i < tabWidgets.length; i++) {
      var widget = tabWidgets[i];
      if (widget.__sbAria) continue;
      widget.__sbAria = true;
      var list = widget.querySelector(".elementor-tabs-wrapper");
      if (list && !list.getAttribute("role")) list.setAttribute("role", "tablist");
      var titles = widget.querySelectorAll(".elementor-tabs-wrapper .elementor-tab-title[data-tab]");
      for (j = 0; j < titles.length; j++) {
        el = titles[j];
        var n = el.getAttribute("data-tab");
        var active = el.classList.contains("elementor-active");
        if (!el.getAttribute("role")) el.setAttribute("role", "tab");
        el.setAttribute("aria-selected", active ? "true" : "false");
        el.setAttribute("tabindex", active ? "0" : "-1");
        panel = widget.querySelector(".elementor-tab-content[data-tab='" + n + "']");
        if (panel) {
          if (!panel.getAttribute("role")) panel.setAttribute("role", "tabpanel");
          if (!panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", ensureId(el, "sb-tab"));
          if (!el.hasAttribute("aria-controls")) el.setAttribute("aria-controls", ensureId(panel, "sb-tabpanel"));
          if (!panel.hasAttribute("tabindex")) panel.setAttribute("tabindex", "0");
        }
      }
    }

    // Bootstrap tabs.
    var bsTabs = root.querySelectorAll("[data-bs-toggle='tab'], [data-toggle='tab'], [data-bs-toggle='pill'], [data-toggle='pill']");
    for (i = 0; i < bsTabs.length; i++) {
      el = bsTabs[i];
      if (el.__sbAria) continue;
      el.__sbAria = true;
      if (!el.getAttribute("role")) el.setAttribute("role", "tab");
      if (!el.hasAttribute("aria-selected")) el.setAttribute("aria-selected", el.classList.contains("active") ? "true" : "false");
      var pane = resolveTarget(el, "data-bs-target") || resolveTarget(el, "data-target") || (el.getAttribute("href") && el.getAttribute("href")[0] === "#" ? document.querySelector(el.getAttribute("href")) : null);
      if (pane) {
        if (!pane.getAttribute("role")) pane.setAttribute("role", "tabpanel");
        if (!el.hasAttribute("aria-controls")) el.setAttribute("aria-controls", ensureId(pane, "sb-tabpanel"));
        if (!pane.hasAttribute("aria-labelledby")) pane.setAttribute("aria-labelledby", ensureId(el, "sb-tab"));
      }
    }
  }

  // Keyboard: Enter/Space activate non-native triggers; arrows move between tabs.
  function onKeyDown(e) {
    if (editing()) return;
    var topPopup = null;
    var openPopups = document.querySelectorAll(".sb-popup.sb-open:not(.sb-closing)");
    for (var p = 0; p < openPopups.length; p++) {
      if (!topPopup || (openPopups[p].__sbOpenedAt || 0) > (topPopup.__sbOpenedAt || 0)) topPopup = openPopups[p];
    }
    if (e.key === "Escape" && topPopup) {
      closeFeedback(topPopup);
      return;
    }
    if (e.key === "Escape") {
      var legacy = topLegacyModal();
      if (legacy) {
        hideLegacyModal(legacy, true);
        return;
      }
    }
    // Keep keyboard focus inside an open popup (dialog focus trap).
    if (e.key === "Tab" && topPopup) {
      var card = topPopup.querySelector(".sb-popup-card") || topPopup;
      var items = focusablesIn(card);
      if (!items.length) { e.preventDefault(); return; }
      var firstItem = items[0];
      var lastItem = items[items.length - 1];
      var active = document.activeElement;
      if (!card.contains(active)) { e.preventDefault(); firstItem.focus(); return; }
      if (e.shiftKey && (active === firstItem || active === card)) { e.preventDefault(); lastItem.focus(); return; }
      if (!e.shiftKey && active === lastItem) { e.preventDefault(); firstItem.focus(); return; }
    }
    var t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      var trigger = closest(t, "[role='button']:not(button), .elementor-tab-title, [data-sb-toggle]:not(button):not(a)");
      if (trigger && trigger === t) {
        e.preventDefault();
        trigger.click();
        return;
      }
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
      var tab = closest(t, "[role='tab']");
      if (!tab || tab !== t) return;
      var list = closest(tab, "[role='tablist']") || tab.parentElement;
      if (!list) return;
      var tabs = list.querySelectorAll("[role='tab']");
      var idx = -1;
      for (var i = 0; i < tabs.length; i++) if (tabs[i] === tab) idx = i;
      if (idx < 0) return;
      e.preventDefault();
      var next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : e.key === "ArrowRight" ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    }
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                          */
  /* ---------------------------------------------------------------- */

  var scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(function () {
      scanTimer = null;
      scan(document.body);
    }, 80);
  }

  function scan(root) {
    if (!root) return;
    scanLegacyModals(root);
    scanSliders(root);
    scanAnimations(root);
    scanCounters(root);
    scanParallax(root);
    scanAria(root);
    scanFeedbackAutoOpen(root);
    scanTriggeredFeedback(root);
  }

  // Called by the accessibility widget ("Stop animations") and when the OS
  // preference changes. Reveals pending entrance animations, halts autoplay
  // and parallax; passing false resumes autoplay/parallax.
  function setReducedMotion(value) {
    forcedReduced = value === null || value === undefined ? null : !!value;
    var on = reduced();
    html.classList.toggle("sb-reduced-motion", on);
    var i;
    if (on) {
      var pending = document.querySelectorAll("[data-sb-anim]:not(.sb-in)");
      for (i = 0; i < pending.length; i++) pending[i].classList.add("sb-in");
      for (i = 0; i < state.parallax.length; i++) {
        state.parallax[i].style.transform = "";
        state.parallax[i].style.backgroundPositionY = "";
      }
    }
    for (i = 0; i < state.sliders.length; i++) {
      if (on) state.sliders[i].stopAutoplay(); else state.sliders[i].startAutoplay();
    }
    if (!on) { scanParallax(document.body); requestParallax(); }
  }

  function refresh() {
    for (var i = 0; i < state.sliders.length; i++) {
      var s = state.sliders[i];
      if (!s.el || !s.el.isConnected) continue;
      s.collectSlides();
      s.layout();
      s.go(Math.min(s.index, s.maxIndex || 0), false);
    }
    requestParallax();
  }

  function init(root) {
    html.classList.add("sb-js");
    html.classList.toggle("sb-reduced-motion", reduced());
    scan(root || document.body);
    if (!state.started) {
      state.started = true;
      if (!state.clickBound) {
        state.clickBound = true;
        document.addEventListener("click", onClick, false);
        document.addEventListener("keydown", onKeyDown, false);
        if (mediaReduced && mediaReduced.addEventListener) {
          mediaReduced.addEventListener("change", function () { setReducedMotion(forcedReduced); });
        }
      }
      var resizeTimer = null;
      window.addEventListener("resize", function () {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(refresh, 120);
      });
      if ("MutationObserver" in window && !state.editWatch) {
        // Editor switched on → undo popup handling; switched off → re-scan.
        state.editWatch = new MutationObserver(function () {
          if (editing()) restoreLegacy();
          else scheduleScan();
        });
        state.editWatch.observe(html, { attributes: true, attributeFilter: ["data-sb-editing"] });
      }
      if ("MutationObserver" in window && document.body) {
        state.mutation = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            if (records[i].addedNodes && records[i].addedNodes.length) { scheduleScan(); return; }
          }
        });
        state.mutation.observe(document.body, { childList: true, subtree: true });
      }
    }
  }

  function destroy() {
    for (var i = 0; i < state.sliders.length; i++) state.sliders[i].destroy();
    state.sliders = [];
    state.parallax = [];
    if (state.animObserver) state.animObserver.disconnect();
    if (state.counterObserver) state.counterObserver.disconnect();
    if (state.mutation) state.mutation.disconnect();
    state.animObserver = state.counterObserver = state.mutation = null;
    state.started = false;
  }

  window.SBEffects = { init: init, refresh: refresh, destroy: destroy, setReducedMotion: setReducedMotion, reduced: reduced, version: 2 };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(document.body); });
  } else {
    init(document.body);
  }
})();
