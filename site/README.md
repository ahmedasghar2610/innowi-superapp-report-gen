# Primo Cafe — Next.js site

This is a Next.js (App Router) rebuild of the original WordPress/Elementor
export in `primocafeav.com`. Same content, same sections, same images —
rebuilt as React components with Tailwind CSS instead of WordPress/Elementor
markup and plugin CSS/JS.

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5050.

### Where the content comes from

This is a multi-site template: `/<slug>` renders one website. Sites are read
from the **Innowi Super App API** (`/api/v1/websites`, port 3000 by default) —
so anything filled in through the Super App's Website module is live here the
moment it is saved. `data/sites/*.json` still works as a fallback.

Reading one site by slug is a public endpoint, so this template needs no
credentials. Copy `.env.example` to `.env` before the first run — without it
`WEBSITE_API_URL` falls back to a default and any slug that has no committed
JSON file will 404.

`TEMPLATE.md` has the full picture, including the environment variables
(`WEBSITE_API_URL`, `SITE_REVALIDATE`, `DEFAULT_SITE`).

To build for production:

```bash
npm run build
npm run start
```

## Project structure

- `app/layout.js` — root layout, fonts, metadata
- `app/page.js` — assembles the homepage from section components
- `components/` — one component per section (Header, Hero, About,
  MenuHighlights, WhyChooseUs, Catering, Testimonials, Contact, Footer)
  plus `CateringForm.js` / `ContactForm.js` (client components) and
  `icons.js` (inline SVG icons, no icon font dependency)
- `public/images/` — all images from the original site, copied over with
  clean filenames (the originals had WordPress cache-busting hashes in
  their names, e.g. `Header-Logo.6591c.png` → `header-logo.png`)

## What changed from the original

- **Forms**: The "Get a Quote" (catering) and "Contact Us" forms are
  rebuilt with the same fields, but they don't submit anywhere yet — the
  original posted to a WordPress backend that no longer exists here. On
  submit they just show a "thanks" message. To make them actually send
  submissions, add a Next.js API route (e.g. `app/api/contact/route.js`)
  that emails the data via a service like Resend, SendGrid, or similar,
  and call it from `CateringForm.js` / `ContactForm.js`.
- **Testimonials**: The original embedded a third-party "Trustindex"
  Google Reviews widget (external script). It's replaced with the same
  4 reviews as static, hardcoded cards — no external script dependency.
  Update `components/Testimonials.js` directly to add/edit reviews, or
  wire up a live Google Reviews API later if you want it to stay current
  automatically.
- **Fonts**: Barlow Condensed (headings) and Roboto (body) are loaded via
  a Google Fonts `<link>` in `app/layout.js`, with system-font fallbacks
  configured in `tailwind.config.js` in case Google Fonts is ever
  unreachable.
- **Styling**: Rebuilt with Tailwind CSS utility classes instead of the
  original Elementor/ElementsKit generated CSS. Colors (red/dark/cream/gold)
  are defined in `tailwind.config.js` under the `primo` palette — tweak
  them there to adjust the whole site's look at once.
- **Navigation**: Same links as the original — Home, About Us (#about),
  Menu (external online-ordering link), Catering (#catering), Contact Us
  (#contact) — plus a working mobile menu (hamburger toggle).
- **Google Map**: Still embedded the same way, via an `<iframe>` pointing
  at the same address.

## Notes

- The site currently has one page (the original was a single-page site
  with anchor links). If you want additional pages later (e.g. a full
  menu page instead of linking out), just add more folders/files under
  `app/`.
- Update the phone number, address, hours, and social links directly in
  `components/Catering.js`, `components/Contact.js`, and
  `components/Footer.js` if they ever change.
