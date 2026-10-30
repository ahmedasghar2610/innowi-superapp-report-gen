// Widget library + section templates inserted by the editor. Markup uses
// neutral .sb-* classes styled by public/sb-widgets.css (shipped in every zip
// and linked by the studio preview).

export type Widget = {
  id: string;
  name: string;
  icon: string; // single glyph
  group: "basic" | "layout" | "media" | "feedback" | "template";
  description: string;
  html: string;
};

function placeholder(w: number, h: number, label = "Image"): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'><rect width='100%' height='100%' fill='#e5e7eb'/><path d='M${w * 0.3} ${h * 0.68}l${w * 0.12} -${h * 0.2} ${w * 0.1} ${h * 0.12} ${w * 0.08} -${h * 0.08} ${w * 0.1} ${h * 0.16}z' fill='#a9b6ca'/><circle cx='${w * 0.66}' cy='${h * 0.34}' r='${Math.min(w, h) * 0.06}' fill='#a9b6ca'/><text x='50%' y='88%' text-anchor='middle' font-family='sans-serif' font-size='${Math.round(h * 0.06)}' fill='#6b7280'>${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const PLACEHOLDER_IMG = placeholder(1200, 800);
const AVATAR = placeholder(160, 160, "");

const W = (id: string) => `data-sb-widget="${id}"`;

export const WIDGETS: Widget[] = [
  {
    id: "section",
    name: "Section",
    icon: "▭",
    group: "layout",
    description: "Full-width block with a centred container.",
    html: `<section class="sb-w sb-section" ${W("section")}><div class="sb-container"><h2 class="sb-heading">New section</h2><p class="sb-text">Add widgets inside this section, or click the text to edit it.</p></div></section>`,
  },
  {
    id: "columns-2",
    name: "2 Columns",
    icon: "▯▯",
    group: "layout",
    description: "Two equal columns.",
    html: `<div class="sb-w sb-columns sb-columns--2" ${W("columns-2")}><div class="sb-col"><p class="sb-text">Left column</p></div><div class="sb-col"><p class="sb-text">Right column</p></div></div>`,
  },
  {
    id: "columns-3",
    name: "3 Columns",
    icon: "▯▯▯",
    group: "layout",
    description: "Three equal columns.",
    html: `<div class="sb-w sb-columns sb-columns--3" ${W("columns-3")}><div class="sb-col"><p class="sb-text">Column 1</p></div><div class="sb-col"><p class="sb-text">Column 2</p></div><div class="sb-col"><p class="sb-text">Column 3</p></div></div>`,
  },
  {
    id: "columns-4",
    name: "4 Columns",
    icon: "▯▯▯▯",
    group: "layout",
    description: "Four equal columns.",
    html: `<div class="sb-w sb-columns sb-columns--4" ${W("columns-4")}><div class="sb-col"><p class="sb-text">Column 1</p></div><div class="sb-col"><p class="sb-text">Column 2</p></div><div class="sb-col"><p class="sb-text">Column 3</p></div><div class="sb-col"><p class="sb-text">Column 4</p></div></div>`,
  },
  {
    id: "spacer",
    name: "Spacer",
    icon: "↕",
    group: "layout",
    description: "Vertical space (resize in Style › Size).",
    html: `<div class="sb-w sb-spacer" ${W("spacer")} aria-hidden="true"></div>`,
  },
  {
    id: "divider",
    name: "Divider",
    icon: "—",
    group: "layout",
    description: "Horizontal rule.",
    html: `<hr class="sb-w sb-divider" ${W("divider")} />`,
  },
  {
    id: "heading",
    name: "Heading",
    icon: "H",
    group: "basic",
    description: "Section title.",
    html: `<h2 class="sb-w sb-heading" ${W("heading")}>Your heading</h2>`,
  },
  {
    id: "text",
    name: "Text",
    icon: "¶",
    group: "basic",
    description: "Paragraph of text.",
    html: `<p class="sb-w sb-text" ${W("text")}>Write something here. Click to edit, paste plain text, press Enter for a new line.</p>`,
  },
  {
    id: "button",
    name: "Button",
    icon: "⬭",
    group: "basic",
    description: "Call-to-action link.",
    html: `<div class="sb-w sb-button-row" ${W("button")}><a class="sb-button" href="#">Get started</a></div>`,
  },
  {
    id: "icon-box",
    name: "Icon box",
    icon: "◈",
    group: "basic",
    description: "Icon, title and short text.",
    html: `<div class="sb-w sb-icon-box" ${W("icon-box")}><div class="sb-icon">★</div><h3 class="sb-heading">Feature title</h3><p class="sb-text">Short description of this feature or service.</p></div>`,
  },
  {
    id: "image",
    name: "Image",
    icon: "▣",
    group: "media",
    description: "Picture with optional caption.",
    html: `<figure class="sb-w sb-image" ${W("image")}><img src="${PLACEHOLDER_IMG}" alt="" width="1200" height="800" /><figcaption>Caption (optional)</figcaption></figure>`,
  },
  {
    id: "video",
    name: "Video",
    icon: "▶",
    group: "media",
    description: "YouTube, Vimeo or MP4.",
    html: `<div class="sb-w sb-video" ${W("video")}><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`,
  },
  {
    id: "gallery",
    name: "Gallery",
    icon: "▦",
    group: "media",
    description: "Grid of images.",
    html: `<div class="sb-w sb-gallery" ${W("gallery")}>${Array.from({ length: 6 })
      .map(() => `<img src="${PLACEHOLDER_IMG}" alt="" />`)
      .join("")}</div>`,
  },
  {
    id: "embed",
    name: "HTML embed",
    icon: "</>",
    group: "media",
    description: "Custom HTML (maps, forms, widgets).",
    html: `<div class="sb-w sb-embed" ${W("embed")}><p class="sb-text">Paste your HTML here using the Content panel.</p></div>`,
  },
  // Popup / Toast / Snackbar share one behavior scheme, all editable from the
  // Content panel once selected (see ContentPanel.tsx "Behavior" section):
  //   data-sb-trigger="load|click|submit"  what opens it:
  //     load (default when set)   auto-opens itself after data-sb-delay
  //     click                     opens when data-sb-trigger-target is clicked
  //     submit                    opens when data-sb-trigger-target (a form) is submitted
  //     omitted                   opens only via a button/link elsewhere that
  //                                points its OWN data-sb-toggle at this
  //                                element's id (the "Opens" field) — the
  //                                same data-sb-toggle mechanism the site
  //                                already uses for menus, independent of
  //                                data-sb-trigger/data-sb-trigger-target.
  //   data-sb-trigger-target="#id"  element the click/submit trigger listens
  //                                  on (a button/link for "click", a <form>
  //                                  for "submit"); ignored for load/omitted.
  //   data-sb-prevent-default        submit trigger only — stops the form's
  //                                  own navigation/reload so the toast stays
  //                                  visible instead of being wiped by the
  //                                  page reloading. Editable in Behavior.
  //   data-sb-delay="<ms>"          delay before auto-opening (trigger=load)
  //   data-sb-frequency="once|always"  once = sessionStorage-guarded (won't
  //                                  re-open on internal page navigation this
  //                                  visit); always = every page load/trigger
  //   data-sb-autodismiss="<ms>"    auto-closes this many ms after it opens,
  //                                  however it was opened (0/absent = stays
  //                                  open until the visitor closes it)
  //   data-sb-position="..."        placement class (Toast/Snackbar)
  //   data-sb-variant="neutral|success|error|warning|info|delete"  Toast/
  //                                  Snackbar only — colors the accent/icon
  //                                  bubble automatically (see sb-widgets.css).
  //   data-sb-icon-auto (on .sb-icon)  present = icon glyph follows the
  //                                  variant automatically; removed the
  //                                  moment the person types their own icon
  //                                  text in the Content panel (see dom.ts).
  // __SB_UID__ becomes a real unique id at insert time (see insertWidget in
  // VisualEditor.tsx) so several instances never collide, and so any button
  // elsewhere on the page can target this one specifically.
  {
    id: "popup",
    name: "Popup",
    icon: "⬚",
    group: "feedback",
    description: "Centred modal — open it from a button, or set it to open automatically.",
    // Ships with a bundled trigger link (click to open); auto-open on load is
    // off by default and turned on from the Behavior section. Hidden by
    // default on the live site; "html[data-sb-editing]" in sb-widgets.css
    // forces it visible inline while editing, same pattern sb-effects.css
    // already uses to keep entrance-animated content visible.
    html: `<a class="sb-w sb-button" href="#" data-sb-toggle="#__SB_UID__" data-sb-toggle-class="sb-open">Open popup</a><div class="sb-w sb-popup" id="__SB_UID__" ${W("popup")} aria-hidden="true"><div class="sb-popup-backdrop" data-sb-dismiss></div><div class="sb-popup-card" role="dialog" aria-modal="true" aria-labelledby="__SB_UID__-title"><button type="button" class="sb-popup-close" data-sb-dismiss aria-label="Close">×</button><div class="sb-icon">★</div><h3 class="sb-heading" id="__SB_UID__-title">Popup title</h3><p class="sb-text">Write your message here. Click to edit.</p><div class="sb-button-row"><a class="sb-button" href="#">Call to action</a></div></div></div>`,
  },
  {
    id: "toast",
    name: "Toast",
    icon: "◰",
    group: "feedback",
    description: "Status card with an icon, title and message — Success, Error, Warning… Stacks in a corner.",
    html: `<div class="sb-w sb-toast" id="__SB_UID__" ${W("toast")} data-sb-trigger="load" data-sb-delay="1000" data-sb-frequency="once" data-sb-autodismiss="6000" data-sb-position="bottom-right" data-sb-variant="info" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true"><button type="button" class="sb-toast-close" data-sb-dismiss aria-label="Dismiss">×</button><div class="sb-icon" data-sb-icon-auto></div><div class="sb-toast-body"><h4 class="sb-heading">Toast heading</h4><p class="sb-text">Short message. Click to edit.</p></div></div>`,
  },
  {
    id: "snackbar",
    name: "Snackbar",
    icon: "▁▁▁",
    group: "feedback",
    description: "One-line message at the bottom edge with one action (e.g. Undo, View). One at a time.",
    html: `<div class="sb-w sb-snackbar" id="__SB_UID__" ${W("snackbar")} data-sb-trigger="load" data-sb-delay="1000" data-sb-frequency="once" data-sb-autodismiss="5000" data-sb-position="bottom-center" role="status" aria-live="polite" aria-atomic="true" aria-hidden="true"><p class="sb-text">Short one-line message. Click to edit.</p><a class="sb-snackbar-action" href="#" data-sb-dismiss>Got it</a><button type="button" class="sb-toast-close" data-sb-dismiss aria-label="Dismiss">×</button></div>`,
  },
];

export const TEMPLATES: Widget[] = [
  {
    id: "tpl-hero",
    name: "Hero",
    icon: "◧",
    group: "template",
    description: "Headline, intro, buttons and an image.",
    html: `<section class="sb-w sb-section sb-hero" ${W("tpl-hero")}><div class="sb-container"><div><span class="sb-eyebrow">Welcome</span><h1 class="sb-heading">A clear headline that explains what you do</h1><p class="sb-text sb-text--lead">One or two sentences that expand on the headline and tell visitors why they should care.</p><div class="sb-button-row"><a class="sb-button" href="#">Primary action</a><a class="sb-button sb-button--outline" href="#">Learn more</a></div></div><figure class="sb-image"><img src="${PLACEHOLDER_IMG}" alt="" width="1200" height="800" /></figure></div></section>`,
  },
  {
    id: "tpl-features",
    name: "Features (3 columns)",
    icon: "⋮⋮⋮",
    group: "template",
    description: "Three icon boxes under a heading.",
    html: `<section class="sb-w sb-section" ${W("tpl-features")}><div class="sb-container"><h2 class="sb-heading sb-heading--center">Why choose us</h2><p class="sb-text sb-text--lead sb-text--center">A short intro for this group of features.</p><div class="sb-spacer" style="--sb-space:32px"></div><div class="sb-columns sb-columns--3"><div class="sb-col sb-icon-box"><div class="sb-icon">★</div><h3 class="sb-heading">Quality</h3><p class="sb-text">Describe the first benefit in a sentence or two.</p></div><div class="sb-col sb-icon-box"><div class="sb-icon">⚡</div><h3 class="sb-heading">Speed</h3><p class="sb-text">Describe the second benefit in a sentence or two.</p></div><div class="sb-col sb-icon-box"><div class="sb-icon">♥</div><h3 class="sb-heading">Care</h3><p class="sb-text">Describe the third benefit in a sentence or two.</p></div></div></div></section>`,
  },
  {
    id: "tpl-cta",
    name: "Call to action",
    icon: "➜",
    group: "template",
    description: "Dark band with heading and button.",
    html: `<section class="sb-w sb-section sb-section--tight sb-section--dark sb-cta" ${W("tpl-cta")}><div class="sb-container"><h2 class="sb-heading">Ready to get started?</h2><a class="sb-button" href="#">Contact us</a></div></section>`,
  },
  {
    id: "tpl-testimonials",
    name: "Testimonials",
    icon: "❝",
    group: "template",
    description: "Three customer quotes.",
    html: `<section class="sb-w sb-section sb-section--light" ${W("tpl-testimonials")}><div class="sb-container"><h2 class="sb-heading sb-heading--center">What customers say</h2><div class="sb-spacer" style="--sb-space:24px"></div><div class="sb-columns sb-columns--3">${[1, 2, 3]
      .map(
        (n) => `<div class="sb-col sb-testimonial"><blockquote>“A short quote from a happy customer goes here. Keep it to two or three lines.”</blockquote><div class="sb-person"><img src="${AVATAR}" alt="" /><div><strong>Customer ${n}</strong><span>Role, Company</span></div></div></div>`,
      )
      .join("")}</div></div></section>`,
  },
  {
    id: "tpl-stats",
    name: "Stats",
    icon: "#",
    group: "template",
    description: "Four animated counters.",
    html: `<section class="sb-w sb-section sb-section--tight" ${W("tpl-stats")}><div class="sb-container"><div class="sb-stats"><div><strong data-sb-counter="250" data-sb-counter-duration="1800">250</strong><span>Projects</span></div><div><strong data-sb-counter="98" data-sb-counter-duration="1800">98%</strong><span>Satisfaction</span></div><div><strong data-sb-counter="12" data-sb-counter-duration="1800">12</strong><span>Years</span></div><div><strong data-sb-counter="40" data-sb-counter-duration="1800">40+</strong><span>Team members</span></div></div></div></section>`,
  },
  {
    id: "tpl-contact",
    name: "Contact info",
    icon: "☏",
    group: "template",
    description: "Address, phone, email and hours.",
    html: `<section class="sb-w sb-section" ${W("tpl-contact")}><div class="sb-container"><div class="sb-columns sb-columns--2"><div class="sb-col"><h2 class="sb-heading">Get in touch</h2><p class="sb-text">We would love to hear from you. Reach out using any of the details on the right.</p></div><div class="sb-col"><ul class="sb-contact-list"><li><span>📍</span><span>123 Main Street, Your City, ST 00000</span></li><li><span>☏</span><a href="tel:+10000000000">+1 (000) 000-0000</a></li><li><span>✉</span><a href="mailto:hello@example.com">hello@example.com</a></li><li><span>🕘</span><span>Mon–Fri 9:00–17:00</span></li></ul></div></div></div></section>`,
  },
  {
    id: "tpl-gallery",
    name: "Gallery grid",
    icon: "▦",
    group: "template",
    description: "Heading plus six images.",
    html: `<section class="sb-w sb-section" ${W("tpl-gallery")}><div class="sb-container"><h2 class="sb-heading sb-heading--center">Gallery</h2><div class="sb-spacer" style="--sb-space:24px"></div><div class="sb-gallery">${Array.from({ length: 6 })
      .map(() => `<img src="${PLACEHOLDER_IMG}" alt="" />`)
      .join("")}</div></div></section>`,
  },
];

const ALL = [...WIDGETS, ...TEMPLATES];

export function findWidget(id: string): Widget | undefined {
  return ALL.find((w) => w.id === id);
}

export function widgetName(id: string): string {
  return findWidget(id)?.name || id;
}
