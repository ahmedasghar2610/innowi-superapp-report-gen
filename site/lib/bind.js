/* =============================================================================
 * lib/bind.js — tie an element in the /admin snapshot to a form answer.
 *
 * Only emitted in snapshot mode (the page the visual editor starts from), so
 * the live template's markup is unchanged. The API reads these attributes to
 * keep form and visual editor in step (innowi-superapp-api-fastapi,
 * app/modules/websites/binding.py):
 *
 *   bind(site, "hero.headline")            element text  <-> answer
 *   bindHref(site, "hero.ctaLink")         href          <-> answer
 *   bindHref(site, "business.phone", "tel")  href derived as tel:/mailto:
 *   bindSrc(site, "about.image")           img src       <-> answer
 *   bindList(site, "offerings.items")      container of a repeating list
 *   bindItem(site)                         one row; paths inside start with "."
 *
 * Bound text must be the element's only content — wrap it in its own <span>
 * when it sits next to an icon.
 * ========================================================================== */

const on = (site) => Boolean(site && site.snapshot);

export const bind = (site, path) => (on(site) && path ? { "data-bind": path } : {});

export const bindHref = (site, path, fmt) =>
  on(site) && path ? { "data-bind-href": path, ...(fmt ? { "data-bind-href-fmt": fmt } : {}) } : {};

export const bindSrc = (site, path) => (on(site) && path ? { "data-bind-src": path } : {});

export const bindList = (site, path) => (on(site) && path ? { "data-bind-list": path } : {});

export const bindItem = (site) => (on(site) ? { "data-bind-item": "" } : {});
