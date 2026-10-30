// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/editor-css.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
import { DROP_INDICATOR_ID, HOVER_ATTR, SEL_ATTR } from "./constants";

/** Injected into the preview iframe. */
export const IFRAME_CSS = `
  [${HOVER_ATTR}] { outline: 2px dashed rgba(44, 103, 245, .7) !important; outline-offset: 2px !important; cursor: pointer !important; }
  [${SEL_ATTR}] { outline: 2px solid #2c67f5 !important; outline-offset: 2px !important; }
  [${SEL_ATTR}][contenteditable] { box-shadow: 0 0 0 4px rgba(44, 103, 245, .18) !important; cursor: text !important; }
  img[${SEL_ATTR}] { cursor: pointer !important; }
  .sb-a11y { display: none !important; }
  a, button { cursor: pointer; }
  #${DROP_INDICATOR_ID} { position: absolute; z-index: 2147483000; pointer-events: none; background: #2c67f5; border-radius: 3px; box-shadow: 0 0 0 2px rgba(255,255,255,.9); transition: top .05s, left .05s, width .05s, height .05s; }
  #${DROP_INDICATOR_ID}.inside { background: rgba(44, 103, 245, .12); border: 2px dashed #2c67f5; box-shadow: none; }
  html[data-sb-dragging] * { cursor: grabbing !important; }
  html[data-sb-dragging] [${HOVER_ATTR}] { outline: none !important; }
  /* An emptied column / container keeps its place and stays clickable. */
  :is(.sb-col, .sb-container, .sb-toast-body, .sb-button-row):empty { min-height: 64px; display: grid; place-items: center; outline: 1px dashed rgba(44, 103, 245, .45); outline-offset: -1px; }
  :is(.sb-col, .sb-container, .sb-toast-body, .sb-button-row):empty::before { content: "Empty — select it, then click a block to add (or Remove it)"; font: 12px/1.4 system-ui, sans-serif; color: rgba(44, 103, 245, .85); }
  .sb-spacer:empty { min-height: 12px; background: repeating-linear-gradient(45deg, rgba(0,0,0,.04) 0 6px, transparent 6px 12px); }
`;

/** Editor shell (host document). Self-contained; never depends on site CSS. */
export const EDITOR_CSS = `
  .sbve { position: fixed; inset: 0; display: grid; grid-template-rows: 50px 1fr; grid-template-columns: 52px 272px 1fr 316px; background: #f5f6f8; color: #32425b; font: 13px/1.45 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; z-index: 2147483000; }
  .sbve.rail-collapsed { grid-template-columns: 52px 0 1fr 316px; }
  .sbve *, .sbve *::before, .sbve *::after { box-sizing: border-box; }
  .sbve button { font: inherit; }
  body:has(.sbve) > .sb-a11y, body:has(.sbve) .sb-a11y { display: none !important; }

  /* top bar */
  .sbve-top { grid-column: 1 / -1; display: flex; align-items: center; gap: .5rem; padding: 0 .75rem; background: #32425b; color: #e6eaf2; border-bottom: 1px solid #3d4f70; overflow: hidden; }
  .sbve-brand { font-weight: 700; letter-spacing: .01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 14rem; }
  .sbve-path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; opacity: .75; white-space: nowrap; }
  .sbve-spacer { flex: 1; }
  .sbve-status { font-size: 12px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 22rem; }
  .sbve-status.dirty { color: #fbbf24; }
  .sbve-status.error { color: #fca5a5; }
  .sbve-devices { display: inline-flex; background: #3d4f70; border-radius: 8px; padding: 2px; gap: 2px; }
  .sbve-devices button { height: 28px; padding: 0 .6rem; border: 0; border-radius: 6px; background: transparent; color: #a9b6ca; cursor: pointer; font-size: 12px; font-weight: 600; }
  .sbve-devices button.active { background: #e6eaf2; color: #32425b; }
  .sbve-btn { display: inline-flex; align-items: center; justify-content: center; gap: .35rem; height: 32px; padding: 0 .8rem; border-radius: 7px; border: 1px solid #e5e7eb; background: #fff; color: #32425b; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; }
  .sbve-btn:hover { background: #f5f6f8; }
  .sbve-btn:disabled { opacity: .45; cursor: default; }
  .sbve-btn.primary { background: #2c67f5; border-color: #2c67f5; color: #fff; }
  .sbve-btn.primary:hover { background: #275bd8; }
  .sbve-btn.ghost { background: transparent; color: #e6eaf2; border-color: #3d4f70; }
  .sbve-btn.ghost:hover { background: #3d4f70; }
  .sbve-btn.danger { color: #dc2626; border-color: rgba(220, 38, 38, .35); }
  .sbve-btn.small { height: 26px; padding: 0 .55rem; font-size: 12px; font-weight: 500; }
  .sbve-btn.icon { width: 32px; padding: 0; }
  .sbve-toggle { display: inline-flex; align-items: center; gap: .4rem; font-size: 12px; color: #e6eaf2; cursor: pointer; user-select: none; white-space: nowrap; }
  .sbve-toggle input { accent-color: #2c67f5; }

  /* left rail */
  .sbve-rail { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 0; background: #32425b; border-right: 1px solid #3d4f70; }
  .sbve-rail button { width: 40px; height: 40px; border: 0; border-radius: 9px; background: transparent; color: #a9b6ca; cursor: pointer; display: grid; place-items: center; font-size: 11px; line-height: 1; gap: 3px; padding: 0; }
  .sbve-rail button .g { font-size: 16px; }
  .sbve-rail button:hover { background: #3d4f70; color: #fff; }
  .sbve-rail button.active { background: #2c67f5; color: #fff; }

  /* panels */
  .sbve-left, .sbve-right { display: flex; flex-direction: column; min-height: 0; background: #fff; overflow: hidden; }
  .sbve-left { border-right: 1px solid #e5e7eb; }
  .sbve-right { border-left: 1px solid #e5e7eb; }
  .sbve-panel-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .7rem .9rem; border-bottom: 1px solid #e5e7eb; font-weight: 700; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
  .sbve-panel-body { flex: 1; overflow-y: auto; min-height: 0; }
  .sbve-tabs { display: flex; border-bottom: 1px solid #e5e7eb; background: #f5f6f8; }
  .sbve-tabs button { flex: 1; height: 38px; border: 0; background: transparent; cursor: pointer; font-weight: 600; color: #6b7280; border-bottom: 2px solid transparent; }
  .sbve-tabs button.active { color: #32425b; border-bottom-color: #2c67f5; }
  .sbve-tabs button .sbve-badge { display: inline-block; min-width: 18px; margin-left: .3rem; padding: 0 .35rem; border-radius: 999px; background: #2c67f5; color: #fff; font-size: 11px; line-height: 18px; vertical-align: 1px; }
  .sbve-tabs button .sbve-badge.ok { background: #059669; }
  .sbve-section { padding: .8rem .9rem; border-bottom: 1px solid #e5e7eb; }

  /* accessibility panel */
  .sbve-a11y-head { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .sbve-a11y-head h3 { margin: 0; }
  .sbve-a11y-summary { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .6rem; }
  .sbve-a11y-summary button { padding: .2rem .5rem; border: 1px solid #e5e7eb; border-radius: 999px; background: #fff; font: inherit; font-size: 12px; cursor: pointer; color: #32425b; }
  .sbve-a11y-summary button b { font-weight: 700; }
  .sbve-a11y-summary button:disabled { opacity: .45; cursor: default; }
  .sbve-a11y-summary button.active { background: #32425b; color: #fff; border-color: #32425b; }
  .sbve-a11y-ok { padding: .8rem; border-radius: 8px; background: #e1f2ed; border: 1px solid #b9e2d3; color: #046c4c; }
  .sbve-a11y-ok p { color: #046c4c; opacity: .85; }
  .sbve-a11y-list { list-style: none; margin: 0; padding: 0; }
  .sbve-a11y-item { border-bottom: 1px solid #e5e7eb; }
  .sbve-a11y-item.selected { background: #f5f6f8; }
  .sbve-a11y-title { display: flex; align-items: flex-start; gap: .5rem; width: 100%; padding: .55rem .9rem; border: 0; background: transparent; font: inherit; text-align: left; cursor: pointer; color: inherit; }
  .sbve-a11y-title:hover { background: #f5f6f8; }
  .sbve-a11y-title .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .1rem; }
  .sbve-a11y-title .k { font-weight: 600; font-size: 13px; }
  .sbve-a11y-title .l { font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sbve-a11y-title .w { flex: none; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #6b7280; background: #f5f6f8; border-radius: 4px; padding: .1rem .3rem; }
  .sbve-a11y-dot { flex: none; width: 10px; height: 10px; margin-top: .3rem; border-radius: 999px; background: #6b7280; }
  .sbve-a11y-dot.sev-critical { background: #dc2626; }
  .sbve-a11y-dot.sev-serious { background: #d97706; }
  .sbve-a11y-dot.sev-moderate { background: #ca8a04; }
  .sbve-a11y-dot.sev-minor { background: #6b7280; }
  .sbve-a11y-detail { padding: 0 .9rem .7rem 2.1rem; }
  .sbve-a11y-detail .m { margin: 0; font-size: 12px; }
  .sbve-a11y-fix { margin-top: .5rem; }
  .sbve-a11y-fix .sbve-row { margin-top: .3rem; flex-wrap: nowrap; }
  .sbve-a11y-fix .sbve-row .sbve-input { flex: 1; }
  .sbve-section h3 { margin: 0 0 .5rem; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: #6b7280; display: flex; align-items: center; justify-content: space-between; }
  .sbve-section h3 button.caret { border: 0; background: transparent; cursor: pointer; color: inherit; font-size: 11px; }
  .sbve-label { display: block; font-weight: 600; margin: .55rem 0 .2rem; font-size: 12px; }
  .sbve-input, .sbve-textarea, .sbve-select { width: 100%; padding: .4rem .5rem; border: 1px solid #e5e7eb; border-radius: 6px; font: inherit; background: #fff; color: inherit; min-width: 0; }
  .sbve-input:focus, .sbve-textarea:focus, .sbve-select:focus { outline: 2px solid rgba(44, 103, 245, .35); border-color: #2c67f5; }
  .sbve-textarea { min-height: 64px; resize: vertical; }
  .sbve-textarea.code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; min-height: 120px; }
  .sbve-hint { color: #6b7280; font-size: 12px; margin: .35rem 0 0; }
  .sbve-empty { padding: 1rem; color: #6b7280; }
  .sbve-chip { display: inline-block; padding: .1rem .45rem; border-radius: 999px; background: #f5f6f8; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
  .sbve-row { display: flex; gap: .4rem; flex-wrap: wrap; margin-top: .6rem; }
  .sbve-thumb { max-width: 100%; max-height: 120px; border-radius: 6px; border: 1px solid #e5e7eb; display: block; margin-top: .4rem; background: #f5f6f8; }

  /* pages list */
  .sbve-pages-form { margin-bottom: .6rem; padding-bottom: .6rem; border-bottom: 1px solid #e5e7eb; }
  .sbve-pages-form code { font-size: 11px; background: #f5f6f8; padding: 0 .25rem; border-radius: 3px; }
  .sbve-csv-preview { list-style: none; margin: .4rem 0 0; padding: 0; max-height: 220px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 6px; }
  .sbve-csv-preview li { padding: .3rem .5rem; border-bottom: 1px solid #f5f6f8; }
  .sbve-csv-preview li:last-child { border-bottom: 0; }
  .sbve-csv-preview li.exists { opacity: .5; }
  .sbve-csv-preview li.more { color: #6b7280; font-size: 12px; }
  .sbve-csv-preview .t { display: block; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sbve-csv-preview .p { display: block; font-size: 11px; opacity: .7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sbve-pages { list-style: none; margin: 0; padding: 0; }
  .sbve-pages li { display: flex; align-items: center; gap: .4rem; }
  .sbve-pages button.page { flex: 1; text-align: left; padding: .4rem .5rem; border: 0; border-radius: 6px; background: transparent; font: inherit; cursor: pointer; color: inherit; min-width: 0; }
  .sbve-pages button.page:hover { background: #f5f6f8; }
  .sbve-pages button.page.active { background: #32425b; color: #fff; }
  .sbve-pages .t { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sbve-pages .p { display: block; font-size: 11px; opacity: .7; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* widgets */
  .sbve-widgets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: .8rem .9rem; }
  .sbve-widget { display: grid; gap: 6px; justify-items: center; padding: 12px 6px 10px; border: 1px solid #e5e7eb; border-radius: 9px; background: #fff; cursor: grab; text-align: center; user-select: none; touch-action: none; }
  .sbve-widget:hover { border-color: #2c67f5; background: #eaf0fe; }
  .sbve-widget:active { cursor: grabbing; }
  .sbve-widget .g { font-size: 20px; line-height: 1; color: #2c67f5; height: 24px; display: grid; place-items: center; }
  .sbve-widget .n { font-weight: 600; font-size: 12px; }
  .sbve-widget.wide { grid-column: 1 / -1; grid-template-columns: 32px 1fr; justify-items: start; text-align: left; align-items: center; padding: 10px 12px; }
  .sbve-widget.wide .d { font-size: 11px; color: #6b7280; grid-column: 2; }
  .sbve-widgets-hint { padding: 0 .9rem .8rem; color: #6b7280; font-size: 12px; }

  /* layers */
  .sbve-layers { padding: .4rem 0; font-size: 12px; }
  .sbve-layer { display: flex; align-items: center; gap: 4px; height: 28px; padding-right: 6px; cursor: pointer; border-radius: 4px; user-select: none; white-space: nowrap; }
  .sbve-layer:hover { background: #f5f6f8; }
  .sbve-layer.selected { background: #32425b; color: #fff; }
  .sbve-layer.drop-before { box-shadow: inset 0 2px 0 #2c67f5; }
  .sbve-layer.drop-after { box-shadow: inset 0 -2px 0 #2c67f5; }
  .sbve-layer.drop-inside { outline: 2px dashed #2c67f5; outline-offset: -2px; }
  .sbve-layer .tw { width: 18px; height: 18px; border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; font-size: 10px; opacity: .7; flex: none; }
  .sbve-layer .tw.leaf { visibility: hidden; }
  .sbve-layer .lb { font-weight: 600; flex: none; }
  .sbve-layer .tx { opacity: .6; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .sbve-layer.selected .tx { opacity: .8; }

  /* canvas */
  .sbve-main { position: relative; min-width: 0; min-height: 0; background: #f5f6f8; overflow: auto; display: block; padding: 0; }
  .sbve-frame { position: relative; width: 100%; height: 100%; background: #fff; transition: width .2s ease; margin: 0 auto; }
  .sbve-frame.device { height: calc(100% - 32px); margin: 16px auto; border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,.18); overflow: hidden; }
  .sbve-frame iframe { width: 100%; height: 100%; border: 0; background: #fff; display: block; }
  .sbve-frame.dragging iframe { pointer-events: auto; }
  .sbve-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .sbve-eltb { position: absolute; display: flex; align-items: center; gap: 2px; padding: 3px; background: #32425b; color: #e6eaf2; border-radius: 7px; box-shadow: 0 4px 14px rgba(0,0,0,.25); pointer-events: auto; font-size: 11px; transform: translateY(-100%); white-space: nowrap; }
  .sbve-eltb .lb { padding: 0 6px; font-weight: 700; }
  .sbve-eltb button { width: 24px; height: 24px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; font-size: 12px; padding: 0; }
  .sbve-eltb button:hover { background: #3d4f70; }
  .sbve-eltb button:disabled { opacity: .35; cursor: default; }
  .sbve-eltb button.grab { cursor: grab; touch-action: none; }
  .sbve-eltb button.danger:hover { background: rgba(220, 38, 38, .25); }
  .sbve-crumbs { position: absolute; left: 0; right: 0; bottom: 0; display: flex; gap: 2px; padding: 4px 8px; background: rgba(50, 66, 91, .92); color: #a9b6ca; font-size: 11px; pointer-events: auto; overflow-x: auto; }
  .sbve-crumbs button { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
  .sbve-crumbs button:hover { background: #3d4f70; color: #fff; }
  .sbve-crumbs button.current { color: #fff; font-weight: 700; }
  .sbve-placing { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); background: #2c67f5; color: #fff; padding: 6px 12px; border-radius: 999px; font-weight: 600; box-shadow: 0 4px 14px rgba(0,0,0,.25); pointer-events: auto; display: flex; gap: 8px; align-items: center; }
  .sbve-placing button { border: 0; background: rgba(255,255,255,.2); color: #fff; border-radius: 999px; padding: 2px 8px; cursor: pointer; }
  .sbve-drag-ghost { position: fixed; z-index: 2147483647; pointer-events: none; padding: 6px 10px; background: #32425b; color: #fff; border-radius: 7px; font-size: 12px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.3); transform: translate(12px, 12px); }

  /* style panel */
  .sbve-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .sbve-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .sbve-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .sbve-field { display: grid; gap: 3px; min-width: 0; }
  .sbve-field > span { font-size: 11px; color: #6b7280; }
  .sbve-field.set > span { color: #2c67f5; font-weight: 600; }
  .sbve-seg { display: inline-flex; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; width: 100%; }
  .sbve-seg button { flex: 1; height: 30px; border: 0; background: #fff; cursor: pointer; color: #6b7280; font-size: 12px; }
  .sbve-seg button + button { border-left: 1px solid #e5e7eb; }
  .sbve-seg button.active { background: #32425b; color: #fff; }
  .sbve-color { display: grid; grid-template-columns: 34px 1fr auto; gap: 6px; align-items: center; }
  .sbve-color input[type="color"] { width: 34px; height: 32px; padding: 0; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; }
  .sbve-clear { border: 0; background: transparent; color: #6b7280; cursor: pointer; font-size: 11px; padding: 0 4px; }
  .sbve-clear:hover { color: #dc2626; }
  .sbve-box { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: auto auto auto; gap: 4px; align-items: center; justify-items: center; background: #f5f6f8; }
  .sbve-box input { width: 54px; text-align: center; padding: .3rem .2rem; }
  .sbve-box .c { grid-column: 2; grid-row: 2; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
  .sbve-box2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
  .sbve-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .sbve-seg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 6px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; color: #374151; font-size: 12px; font-weight: 500; cursor: pointer; }
  .sbve-seg-btn:hover { background: #f5f6f8; }
  .sbve-seg-btn.active { border-color: #2c67f5; background: #eaf0fe; color: #1d4ed8; }
  .sbve-seg-btn .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; flex: none; }
  .sbve-v-success .dot { background: #16a34a; }
  .sbve-v-error .dot, .sbve-v-delete .dot { background: #dc2626; }
  .sbve-v-warning .dot { background: #d97706; }
  .sbve-v-info .dot { background: #2563eb; }
  .sbve-device-note { display: flex; align-items: center; gap: 6px; padding: .5rem .9rem; background: #eaf0fe; color: #9c5604; font-size: 12px; border-bottom: 1px solid #e5e7eb; }
  .sbve-range { display: grid; grid-template-columns: 1fr 52px; gap: 6px; align-items: center; }
  .sbve-range input[type="range"] { width: 100%; accent-color: #2c67f5; }
`;
