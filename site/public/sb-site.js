/* Runtime for pages saved from the /<slug>/admin editor.
 *
 * Those pages are plain HTML (React isn't running inside them), so the few
 * interactive bits the template's React components normally handle are done
 * here instead. public/sb-effects.js covers animations and the mobile menu.
 *
 *  [data-sb-form]   contact / catering forms: show the thank-you message
 *                   from data-sb-success instead of submitting.
 *  [data-sb-embed]  a pasted reviews widget: inject its code and run its
 *                   <script> tags (innerHTML alone never runs them).
 */
(function () {
  "use strict";
  if (typeof document === "undefined") return;

  function forms(root) {
    root.querySelectorAll("form[data-sb-form]").forEach(function (form) {
      if (form.__sbForm) return;
      form.__sbForm = true;
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        // No backend is wired yet — same as the live template's forms.
        var done = document.createElement("div");
        done.className = form.getAttribute("data-sb-success-class") || "";
        done.setAttribute("role", "status");
        done.textContent = form.getAttribute("data-sb-success") || "Thanks! We'll be in touch.";
        form.replaceWith(done);
      });
    });
  }

  function embeds(root) {
    root.querySelectorAll("[data-sb-embed]").forEach(function (host) {
      if (host.__sbEmbed) return;
      host.__sbEmbed = true;
      var code = host.getAttribute("data-sb-embed");
      if (!code) return;
      host.innerHTML = code;
      host.querySelectorAll("script").forEach(function (old) {
        var s = document.createElement("script");
        for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
        s.text = old.text;
        old.replaceWith(s);
      });
    });
  }

  function init() {
    forms(document);
    embeds(document);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
