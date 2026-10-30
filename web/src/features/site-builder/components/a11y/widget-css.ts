// Styles for the accessibility widget and for the page-level adjustments it
// applies (classes on <html>). Self-contained; relative imports only.

const CURSOR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="M5 2.5 19.5 12l-6.2 1.3 3.6 6.9-2.7 1.4-3.6-7L5 19.5z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
);

/** Everything on the page except the widget itself. */
const PAGE = "html.sb-a11y-active body *:not(.sb-a11y):not(.sb-a11y *)";

/**
 * The widget renders inside cloned pages whose stylesheets freely style bare
 * `button`, `a`, `h2`, `small`… (Elementor kits, theme resets). Every shell
 * declaration is made `!important` so those rules cannot recolor or resize the
 * widget, and a zero-specificity reset (`:where(.sb-a11y) …`) clears the usual
 * theme properties first. Specific `.sb-a11y-*` rules still win over the reset
 * because both are important and the class selectors are more specific.
 */
function harden(css: string): string {
  return css.replace(/\{([^{}]*)\}/g, (_m, body: string) => {
    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (/!important$/i.test(d) ? d : `${d} !important`));
    return `{ ${decls.join("; ")}; }`;
  });
}

const SHELL_CSS = harden(`
/* ---- reset against host-page styles --------------------------------- */
:where(.sb-a11y) :is(button, a, h2, h3, p, small, span, ul, li, div, section, label) { margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; font: inherit; text-transform: none; text-decoration: none; text-shadow: none; box-shadow: none; transition: none; transform: none; opacity: 1; min-width: 0; min-height: 0; width: auto; height: auto; float: none; position: static; white-space: normal; overflow: visible; }
:where(.sb-a11y) :is(ul, li) { list-style: none; }
:where(.sb-a11y) button { appearance: none; -webkit-appearance: none; }

/* ---- widget shell --------------------------------------------------- */
.sb-a11y, .sb-a11y * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important; letter-spacing: normal !important; line-height: 1.35 !important; text-align: left !important; }
.sb-a11y { position: fixed; bottom: 20px; z-index: 2147483000; color: #1a1612; font-size: 14px; }
.sb-a11y[data-position="right"] { right: 20px; }
.sb-a11y[data-position="left"] { left: 20px; }
.sb-a11y-trigger { width: 52px; height: 52px; border-radius: 999px; border: 2px solid #1a1612; background: #1a1612; color: #fff; cursor: pointer; display: grid; place-items: center; box-shadow: 0 4px 14px rgba(0,0,0,.25); padding: 0; }
.sb-a11y-trigger svg { width: 30px; height: 30px; fill: currentColor; }
.sb-a11y-trigger:hover { background: #c45c26; border-color: #c45c26; }
.sb-a11y :focus-visible, .sb-a11y-trigger:focus-visible { outline: 3px solid #005fcc !important; outline-offset: 3px !important; box-shadow: 0 0 0 5px #fff; }
.sb-a11y-panel { position: absolute; bottom: 64px; width: min(360px, calc(100vw - 32px)); max-height: min(78vh, 720px); overflow: auto; background: #fff; color: #1a1612; border: 1px solid #cfc8bb; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.3); padding: 0 0 12px; }
.sb-a11y[data-position="right"] .sb-a11y-panel { right: 0; }
.sb-a11y[data-position="left"] .sb-a11y-panel { left: 0; }
.sb-a11y-head { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; background: #1a1612; color: #fff; }
.sb-a11y-head h2 { margin: 0 !important; font-size: 16px !important; font-weight: 700 !important; color: #fff !important; }
.sb-a11y-head small { display: block; font-size: 11px; opacity: .8; color: #fff; }
.sb-a11y-icon-btn { width: 36px; height: 36px; border-radius: 8px; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; cursor: pointer; font-size: 18px; }
.sb-a11y-icon-btn:hover { background: rgba(255,255,255,.15); }
.sb-a11y-lang { display: flex; gap: 4px; }
.sb-a11y-lang button { min-width: 34px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff; cursor: pointer; font-size: 12px; font-weight: 600; }
.sb-a11y-lang button[aria-pressed="true"] { background: #fff; color: #1a1612; }
.sb-a11y-section { padding: 12px 14px 4px; }
.sb-a11y-section h3 { margin: 0 0 8px !important; font-size: 12px !important; letter-spacing: .1em !important; text-transform: uppercase; color: #6b665e !important; font-weight: 700 !important; }
.sb-a11y-hint { margin: 0 0 8px !important; font-size: 12px !important; color: #6b665e !important; }
.sb-a11y-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.sb-a11y-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-height: 58px; padding: 8px 10px; border-radius: 10px; border: 1px solid #cfc8bb; background: #faf8f3; color: #1a1612; cursor: pointer; font-size: 13px; font-weight: 600; }
.sb-a11y-tile small { font-weight: 400; font-size: 11px; color: #57524a; }
.sb-a11y-tile:hover { border-color: #1a1612; }
.sb-a11y-tile[aria-pressed="true"], .sb-a11y-tile[aria-checked="true"] { background: #1a1612; border-color: #1a1612; color: #fff; }
.sb-a11y-tile[aria-pressed="true"] small, .sb-a11y-tile[aria-checked="true"] small { color: #e8e2d6; }
.sb-a11y-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid #efeae0; font-size: 14px; }
.sb-a11y-row:last-child { border-bottom: 0; }
.sb-a11y-row > span:first-child { flex: 1; }
.sb-a11y-seg { display: inline-flex; border: 1px solid #cfc8bb; border-radius: 8px; overflow: hidden; }
.sb-a11y-seg button { min-width: 36px; height: 32px; padding: 0 8px; border: 0; border-right: 1px solid #cfc8bb; background: #fff; color: #1a1612; cursor: pointer; font-size: 13px; font-weight: 600; }
.sb-a11y-seg button:last-child { border-right: 0; }
.sb-a11y-seg button[aria-pressed="true"] { background: #1a1612; color: #fff; }
.sb-a11y-seg button:disabled { opacity: .4; cursor: default; }
.sb-a11y-value { min-width: 44px; text-align: center !important; font-weight: 700; font-variant-numeric: tabular-nums; }
.sb-a11y-switch { position: relative; width: 46px; height: 26px; border-radius: 999px; border: 1px solid #8a8378; background: #d9d3c7; cursor: pointer; padding: 0; flex: none; }
.sb-a11y-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .15s; }
.sb-a11y-switch[aria-checked="true"] { background: #1a7f37; border-color: #1a7f37; }
.sb-a11y-switch[aria-checked="true"]::after { transform: translateX(20px); }
.sb-a11y-footer { display: grid; gap: 8px; padding: 12px 14px 0; }
.sb-a11y-btn { height: 40px; border-radius: 8px; border: 1px solid #1a1612; background: #fff; color: #1a1612; cursor: pointer; font-size: 14px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
.sb-a11y-btn.primary { background: #1a1612; color: #fff; }
.sb-a11y-btn:hover { background: #c45c26; border-color: #c45c26; color: #fff; }
.sb-a11y-credit { margin: 8px 0 0 !important; font-size: 11px !important; color: #6b665e !important; text-align: center !important; }
.sb-a11y-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.sb-a11y-list { list-style: none; margin: 0; padding: 0; }
.sb-a11y-list li { border-bottom: 1px solid #efeae0; }
.sb-a11y-back { width: 100%; margin-bottom: 10px; }
.sb-a11y-empty { padding: 8px; color: #57524a; }
.sb-a11y-list button { width: 100%; text-align: left !important; padding: 8px 6px 8px calc(var(--sb-a11y-indent, 0) * 10px + 6px); border: 0; background: transparent; color: #1a1612; cursor: pointer; font-size: 13px; display: flex; gap: 8px; align-items: baseline; }
.sb-a11y-list button:hover { background: #f4efe4; }
.sb-a11y-list .lvl { flex: none; font-size: 11px; font-weight: 700; color: #6b665e; min-width: 22px; }
.sb-a11y-list .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-a11y-tabs { display: flex; gap: 4px; margin: 0 0 8px; }
.sb-a11y-tabs button { flex: 1; height: 32px; border-radius: 8px; border: 1px solid #cfc8bb; background: #fff; color: #1a1612; cursor: pointer; font-size: 13px; font-weight: 600; }
.sb-a11y-tabs button[aria-selected="true"] { background: #1a1612; color: #fff; border-color: #1a1612; }

/* ---- overlays ------------------------------------------------------- */
.sb-a11y-guide { position: fixed; left: 0; right: 0; height: 10px; margin-top: 24px; background: #c45c26; opacity: .85; pointer-events: none; z-index: 2147482000; border-radius: 4px; }
.sb-a11y-mask { position: fixed; left: 0; right: 0; background: rgba(0,0,0,.65); pointer-events: none; z-index: 2147481000; }
.sb-a11y-mask.top { top: 0; }
.sb-a11y-mask.bottom { bottom: 0; }
`);

export const WIDGET_CSS = `${SHELL_CSS}
/* ---- page adjustments (classes on <html>) --------------------------- */
html.sb-a11y-font-readable body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-font-readable")} { font-family: Verdana, Tahoma, "DejaVu Sans", Geneva, sans-serif !important; }
html.sb-a11y-font-dyslexic body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-font-dyslexic")} { font-family: "OpenDyslexic", "Comic Sans MS", "Comic Neue", Verdana, sans-serif !important; }

html.sb-a11y-lh-1 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-lh-1")} { line-height: 1.6 !important; }
html.sb-a11y-lh-2 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-lh-2")} { line-height: 1.9 !important; }
html.sb-a11y-lh-3 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-lh-3")} { line-height: 2.2 !important; }
html.sb-a11y-ls-1 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-ls-1")} { letter-spacing: .06em !important; word-spacing: .12em !important; }
html.sb-a11y-ls-2 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-ls-2")} { letter-spacing: .12em !important; word-spacing: .2em !important; }
html.sb-a11y-ls-3 body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-ls-3")} { letter-spacing: .18em !important; word-spacing: .3em !important; }
${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-align-left")} { text-align: left !important; }
${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-align-center")} { text-align: center !important; }
${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-align-right")} { text-align: right !important; }

html.sb-a11y-titles body :is(h1,h2,h3,h4,h5,h6):not(.sb-a11y *) { outline: 3px solid #c45c26 !important; outline-offset: 3px !important; background: #fff3e6 !important; color: #1a1612 !important; }
html.sb-a11y-links body a:not(.sb-a11y *) { outline: 2px solid #005fcc !important; outline-offset: 2px !important; text-decoration: underline !important; background: #fff9c4 !important; color: #003c8f !important; }
html.sb-a11y-focus body *:focus:not(.sb-a11y *) { outline: 4px solid #ff8c00 !important; outline-offset: 3px !important; box-shadow: 0 0 0 7px #fff !important; }

/* Real colors — not filter: contrast(). Images/media keep their pixels. */
html.sb-a11y-contrast-high body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-contrast-high")}:not(img):not(video):not(svg):not(svg *):not(canvas):not(iframe) { background-color: #000 !important; background-image: none !important; color: #ffff00 !important; border-color: #ffff00 !important; text-shadow: none !important; box-shadow: none !important; }
html.sb-a11y-contrast-high body a:not(.sb-a11y *), html.sb-a11y-contrast-high body a:not(.sb-a11y *) * { color: #00ffff !important; text-decoration: underline !important; }
html.sb-a11y-contrast-high body :is(button,input,select,textarea,[role="button"]):not(.sb-a11y *) { background-color: #000 !important; color: #ffff00 !important; border: 2px solid #ffff00 !important; }
html.sb-a11y-contrast-high body ::placeholder { color: #ffff99 !important; }

html.sb-a11y-contrast-dark body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-contrast-dark")}:not(img):not(video):not(svg):not(svg *):not(canvas):not(iframe) { background-color: #121212 !important; background-image: none !important; color: #f5f5f5 !important; border-color: #5c5c5c !important; text-shadow: none !important; }
html.sb-a11y-contrast-dark body a:not(.sb-a11y *), html.sb-a11y-contrast-dark body a:not(.sb-a11y *) * { color: #8ab4f8 !important; text-decoration: underline !important; }
html.sb-a11y-contrast-dark body :is(button,input,select,textarea,[role="button"]):not(.sb-a11y *) { background-color: #1f1f1f !important; color: #fff !important; border: 2px solid #9a9a9a !important; }

html.sb-a11y-contrast-light body, ${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-contrast-light")}:not(img):not(video):not(svg):not(svg *):not(canvas):not(iframe) { background-color: #fff !important; background-image: none !important; color: #111 !important; border-color: #444 !important; text-shadow: none !important; }
html.sb-a11y-contrast-light body a:not(.sb-a11y *), html.sb-a11y-contrast-light body a:not(.sb-a11y *) * { color: #0645ad !important; text-decoration: underline !important; }
html.sb-a11y-contrast-light body :is(button,input,select,textarea,[role="button"]):not(.sb-a11y *) { background-color: #fff !important; color: #111 !important; border: 2px solid #111 !important; }

html.sb-a11y-mono body > *:not(.sb-a11y) { filter: grayscale(1); }
html.sb-a11y-sat-low body > *:not(.sb-a11y) { filter: saturate(.4); }
html.sb-a11y-sat-high body > *:not(.sb-a11y) { filter: saturate(2); }
html.sb-a11y-invert body > *:not(.sb-a11y) { filter: invert(1) hue-rotate(180deg); }
html.sb-a11y-invert body :is(img, video, picture, canvas, iframe):not(.sb-a11y *) { filter: invert(1) hue-rotate(180deg); }
html.sb-a11y-mono.sb-a11y-invert body > *:not(.sb-a11y) { filter: grayscale(1) invert(1); }

html.sb-a11y-cursor, html.sb-a11y-cursor body *:not(.sb-a11y):not(.sb-a11y *) { cursor: url("data:image/svg+xml,${CURSOR_SVG}") 6 4, auto !important; }
html.sb-a11y-cursor body :is(a,button,[role="button"],input,select,label):not(.sb-a11y *) { cursor: url("data:image/svg+xml,${CURSOR_SVG}") 6 4, pointer !important; }

html.sb-a11y-no-motion *, html.sb-a11y-no-motion *::before, html.sb-a11y-no-motion *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
html.sb-a11y-no-motion body [data-sb-anim]:not(.sb-a11y *) { opacity: 1 !important; transform: none !important; visibility: visible !important; }

html.sb-a11y-no-images body :is(img, picture, video, canvas, svg):not(.sb-a11y):not(.sb-a11y *) { visibility: hidden !important; }
${PAGE.replace("html.sb-a11y-active", "html.sb-a11y-no-images")} { background-image: none !important; }
`;
