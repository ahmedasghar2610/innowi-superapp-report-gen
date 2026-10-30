// COPIED from innowi-superapp-web/src/features/site-builder/components/editor/constants.ts by scripts/sync-editor.cjs.
// Edit it there, then run `npm run sync-editor`.
export const SEL_ATTR = "data-sb-selected";
export const HOVER_ATTR = "data-sb-hover";
export const ID_ATTR = "data-sb-id";
export const WIDGET_ATTR = "data-sb-widget";
export const EDITOR_STYLE_ID = "sb-editor-style";
export const PAGE_STYLE_ID = "sb-page-css";
export const THEME_STYLE_ID = "sb-theme-css";
export const DROP_INDICATOR_ID = "sb-drop-indicator";
export const MAX_HISTORY = 80;

/** Elements that never get contenteditable. */
export const NON_TEXT_TAGS = new Set([
  "img",
  "svg",
  "video",
  "audio",
  "iframe",
  "picture",
  "source",
  "input",
  "select",
  "textarea",
  "br",
  "hr",
  "canvas",
  "embed",
  "object",
]);

/** Elements whose own text is edited in place when selected. */
export const TEXT_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "a",
  "button",
  "li",
  "td",
  "th",
  "label",
  "blockquote",
  "figcaption",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "dt",
  "dd",
  "legend",
  "summary",
  "cite",
  "q",
  "mark",
  "time",
  "address",
  "pre",
  "code",
]);
