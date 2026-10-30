// Auto-generated, editable /accessibility statement page for cloned sites.
// Uses the home page's header/footer so it looks like the rest of the site;
// the widget footer links to it. Plain HTML + per-page CSS, no dependencies.
import { escapeHtml, extractShellFromHtml, type PageRecord } from "@/features/site-builder/server/content-store";

export const STATEMENT_PATH = "/accessibility";

export type StatementInput = {
  siteName: string;
  origin: string;
  /** Home page HTML (already rewritten) used for header/footer + contact scan. */
  homeHtml: string;
  /** Extra pages' HTML to widen the contact search (optional). */
  otherHtml?: string[];
  date?: Date;
};

const CONTACT_LINK_RE = /href\s*=\s*["']\s*(mailto:|tel:)([^"'?#\s]+)/gi;

/** First mailto:/tel: found in the site, if any. */
export function findContact(htmls: string[]): { email?: string; phone?: string } {
  const out: { email?: string; phone?: string } = {};
  for (const html of htmls) {
    for (const match of html.matchAll(CONTACT_LINK_RE)) {
      const kind = match[1].toLowerCase();
      const value = decodeURIComponent(match[2]).trim();
      if (kind === "mailto:" && !out.email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(value)) out.email = value;
      if (kind === "tel:" && !out.phone && /\d{6,}/.test(value.replace(/\D/g, ""))) out.phone = value;
      if (out.email && out.phone) return out;
    }
  }
  return out;
}

export const STATEMENT_CSS = `
/* Accessibility statement — per-page CSS, editable in the Style panel */
#cloned-root .sb-a11y-statement {
  max-width: 44rem;
  margin: 2.5rem auto 4rem;
  padding: 0 1.25rem;
  line-height: 1.7;
}
#cloned-root .sb-a11y-statement h1 { margin: 0 0 1rem; line-height: 1.15; }
#cloned-root .sb-a11y-statement h2 { margin: 2rem 0 0.75rem; font-size: 1.35em; }
#cloned-root .sb-a11y-statement p, #cloned-root .sb-a11y-statement li { margin: 0 0 0.9rem; }
#cloned-root .sb-a11y-statement ul { padding-left: 1.25rem; }
/* 1.4.1: links in body text must not rely on color alone */
#cloned-root .sb-a11y-statement a { text-decoration: underline; text-underline-offset: 0.15em; }
#cloned-root .sb-a11y-statement .sb-a11y-meta { font-size: 0.9em; opacity: 0.75; }
#cloned-root .sb-a11y-statement .sb-a11y-todo { border-left: 4px solid #c45c26; padding: 0.5rem 0.9rem; background: rgba(196, 92, 38, 0.08); }
`;

export function renderStatementHtml(input: StatementInput): string {
  const shell = extractShellFromHtml(input.homeHtml);
  const contact = findContact([input.homeHtml, ...(input.otherHtml ?? [])]);
  const date = (input.date ?? new Date()).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const name = escapeHtml(input.siteName || "This website");
  let host = "";
  try {
    host = new URL(input.origin).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }

  const contactItems: string[] = [];
  if (contact.email) contactItems.push(`<li>Email: <a href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a></li>`);
  if (contact.phone) contactItems.push(`<li>Phone: <a href="tel:${escapeHtml(contact.phone)}">${escapeHtml(contact.phone)}</a></li>`);
  const contactBlock = contactItems.length
    ? `<ul>\n${contactItems.map((li) => `        ${li}`).join("\n")}\n      </ul>`
    : `<p class="sb-a11y-todo"><strong>Add your contact details here</strong> (email and/or phone) so visitors can report accessibility barriers. Edit this page in the admin editor.</p>`;

  return `${shell.header}
<main class="sb-a11y-statement" id="main-content">
    <h1>Accessibility Statement</h1>
    <p class="sb-a11y-meta">Last updated ${escapeHtml(date)}</p>

    <p>${name} is committed to ensuring digital accessibility for people with disabilities. We are continually improving the user experience for everyone and applying the relevant accessibility standards so that our website${host ? ` (${escapeHtml(host)})` : ""} is usable by as many people as possible.</p>

    <h2>Conformance status</h2>
    <p>The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" rel="noopener">Web Content Accessibility Guidelines (WCAG)</a> define requirements for designers and developers to improve accessibility for people with disabilities. They define three levels of conformance: Level A, Level AA, and Level AAA. This website aims to conform to <strong>WCAG 2.1 Level AA</strong>. We are partially conformant, meaning some parts of the content may not yet fully conform to the standard; we are actively working to resolve them.</p>

    <h2>Measures we take</h2>
    <ul>
      <li>An accessibility menu on every page (the round button in the corner, or press <kbd>Ctrl</kbd> + <kbd>U</kbd>) with profiles for seizure safety, low vision, ADHD, cognitive and learning needs, keyboard navigation and screen readers, plus controls for text size, spacing, fonts, contrast, colour, reading guide and mask, big cursor, and stopping animations.</li>
      <li>A "Skip to content" link as the first focusable element on each page, visible keyboard focus indicators, and consistent keyboard operation of menus, tabs, accordions and carousels.</li>
      <li>Text alternatives for images, labels for form fields, titles for embedded content, and a defined page language so assistive technology can read the content correctly.</li>
      <li>Carousels pause when hovered or focused and respect the operating system's reduced-motion preference.</li>
      <li>Regular reviews with automated and manual accessibility checks as content changes.</li>
    </ul>

    <h2>Known limitations</h2>
    <p class="sb-a11y-todo">Despite our best efforts, some content may not yet be fully accessible. Replace this paragraph with anything you know about — for example third-party embeds (maps, videos, booking widgets), PDF documents, or user-generated content — and what you are doing about it.</p>

    <h2>Compatibility</h2>
    <p>This website is designed to work with current versions of major browsers (Chrome, Firefox, Safari, Edge) and with common assistive technologies such as screen readers (NVDA, JAWS, VoiceOver, TalkBack), screen magnifiers, and speech recognition software. It is responsive and usable on mobile devices.</p>

    <h2>Feedback</h2>
    <p>We welcome your feedback on the accessibility of this website. If you encounter accessibility barriers, please let us know and we will try to respond within 5 business days:</p>
      ${contactBlock}

    <h2>Formal complaints</h2>
    <p>If you are not satisfied with our response, you may be able to contact the relevant enforcement body in your country. In the United States this includes the <a href="https://www.ada.gov/" rel="noopener">U.S. Department of Justice (ADA)</a>.</p>
</main>
${shell.footer}`;
}

export function statementPageRecord(input: StatementInput): PageRecord {
  return {
    title: `Accessibility Statement | ${input.siteName || "Website"}`,
    description: `Accessibility statement for ${input.siteName || "this website"}: our commitment to WCAG 2.1 AA, the measures we take, known limitations, and how to report barriers.`,
    html: renderStatementHtml(input),
    css: STATEMENT_CSS,
    updatedAt: new Date().toISOString(),
  };
}
