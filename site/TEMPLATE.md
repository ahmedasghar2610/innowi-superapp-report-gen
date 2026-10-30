# Template guide

This project is a **template**. The design and all icons are fixed and shared.
Everything else — including button text, navigation labels, section eyebrows
and form wording — comes from each site's data, with `lib/labels.js` supplying
the default wording wherever a site leaves a label empty.

That data comes from one of two places, tried in order:

**1. The Innowi Super App API** — `/api/v1/websites`. Every website filled in
through the Super App (Web & Search → Website) is stored there, and its `slug`
is this template's URL. (These endpoints were a standalone FastAPI service on
:8000 until it was merged into the main API.)

```
Super App → "New website" → fill the form → Save
                                  ↓
                 POST /api/v1/websites  (slug: primo-cafe)
                                  ↓
                    this template at  /primo-cafe
```

Nothing is exported and no file is written. Save the form and the page is live
on the next request — the "Visit site" button in the Super App's website list
links straight to it.

**2. `data/sites/<slug>.json`** — as before. Drop a JSON file in that folder and
that slug exists. Kept as a fallback so the bundled demo sites still work with
the API stopped, and so a site can live in the repo without going through the
app.

```
data/sites/primo-cafe.json   ->   /primo-cafe
data/sites/rosa-pizza.json   ->   /rosa-pizza
```

The API stores the answers in exactly the shape these JSON files already use,
so both sources go through the same normaliser in `lib/sites.js`. When a slug
exists in both, **the API wins** — the app is the source of truth.

## What is fixed vs. what is data

**Fixed — `components/icons.js`** — the icons, and the layout itself.

**Default wording — `lib/labels.js`**

Every button label, nav item, section eyebrow, form placeholder and success
message has a default in `lib/labels.js`, copied verbatim from the original
Primo Cafe site. A site's own text wins: `resolveLabels()` lays each site's
wording over the defaults key by key, and `lib/sites.js` publishes the result as
`site.labels`, which is all the components read. Sites imported from a website
content .docx carry their own wording for almost all of these.

| Label | Site key | Default |
|---|---|---|
| Nav links (5, in order) | `labels.nav` — `Home · About · Menu · Catering · Contact` | Home · About Us · Menu · Catering · Contact Us |
| Header button | `labels.headerCta` | Order Online |
| Hero / about buttons | `hero.ctaLabel`, `about.ctaLabel` (+ `ctaLink`) | Order Priority Pickup (Direct) / Order Direct Delivery (Best Price) |
| Eyebrows | `about.eyebrow`, `offerings.eyebrow`, `social.eyebrow`, `catering.eyebrow`, `social.reviewsEyebrow` | About us · Delicious Menu · Why choose us · Catering · Testimonials |
| Menu buttons | `offerings.ctaLabel`, `offerings.cardCta` | View Full Menu & Order Direct / (none on cards) |
| Catering | `catering.ctaLabel`, `formTitle`, `formFields`, `submitLabel`, `success` | phone number · Get a Quote · Request Catering |
| Reviews button | `social.reviewsLinkLabel` (+ `social.reviewsUrl`) | Read our reviews on Google |
| Contact | `contact.heading`, `formFields`, `submitLabel`, `success`, `directionsLabel` | Contact Us · Send Message · (no directions button) |
| Footer | `footer.quickLinks`, `footer.rights` | Home · About Us · Menu · Contact Us · All Rights Reserved |

Form fields are one line separated with `·`, e.g. `Your name · Email · Phone ·
Event date · Time · Number of people · Message (pickup or delivery)`. Each is
matched to an input type by its wording; text in brackets becomes the hint
inside the box.

**Data — the API record, or `data/sites/<slug>.json`**

Business details, brand colours and fonts, hero copy, the about story, menu
items, selling points, reviews, catering copy, the map address, footer blurb
and social links. Plus `orderUrl`, the one link every button points at.

The keys are exactly the ones the Website Details Form writes, so the API's
stored answers and a hand-written JSON file are interchangeable.

Two things are derived rather than stored, in `lib/sites.js`:

- **`orderUrl`** falls back to the hero / about / menu button links when the
  form's dedicated ordering field is empty.
- **Fonts.** The form collects a family name ("Poppins"); the template turns it
  into a full CSS stack *and* fetches that family from Google Fonts. Without
  that second half a named font would silently render as a system serif.

## Files

| File | Role |
|---|---|
| `data/sites/*.json` | One file per site. The filename is the slug |
| `lib/labels.js` | Default wording — buttons, nav, eyebrows, form copy — and `resolveLabels()` |
| `lib/sites.js` | `getSite(slug)`, `listSlugs()`, `DEFAULT_SLUG` — reads the API, falls back to the folder (server only) |
| `lib/format.js` | Pure helpers — contrast maths, theme CSS variables, image placeholder, text |
| `lib/metadata.js` | Per-slug `<title>`, description and favicon |
| `app/page.js` | `/` renders `DEFAULT_SLUG` |
| `app/[slug]/page.js` | `/<slug>`, statically generated from the folder |
| `components/SitePage.js` | Composes the page and injects the slug's colours |
| `components/*.js` | Sections. Each takes a `site` prop |
| `components/icons.js` | The icon set. Unchanged |

## Adding a site

**Through the app (the normal way)**

1. In the Super App, go to **Web & Search → Website** and press **New website**.
2. Fill in the seven steps and save. The API derives the slug from the business
   name — "Primo Cafe" becomes `primo-cafe`.
3. Press **Visit site** on its row. That's it.

Images can be pasted in as `https://` URLs or uploaded in the form (they are
stored inline). Anything left empty draws a placeholder.

**By hand (committed to the repo)**

1. Save a completed `website-data.json` as `data/sites/your-slug.json`.
2. Add `"orderUrl"` (the ordering or booking link) and, if you want a catering
   section, a `"catering": { "heading": …, "body": … }` block.
3. Put any images under `public/images/` and reference them as
   `/images/name.jpg`, or use full `https://` URLs, or leave them empty.

`npm run dev` — the page is at `/your-slug`.

## Configuration

| Variable          | Default                     | What it does                                        |
| ----------------- | --------------------------- | --------------------------------------------------- |
| `WEBSITE_API_URL`   | `http://localhost:3000/api/v1` | Where the Super App API runs                        |
| `SITE_REVALIDATE`   | `0`                            | Seconds to cache an API response; 0 = every request |
| `DEFAULT_SITE`      | *(unset)*                      | The slug served at `/`; unset means `/` is a 404    |
| `WEBSITE_API_TOKEN` | *(unset)*                      | Optional; only lets `generateStaticParams` see API-only slugs |

Copy `.env.example` to `.env` before the first run. Next.js does not read
`.env.example`, so without that copy `WEBSITE_API_URL` silently falls back to
its default — and a wrong default means every API fetch fails and any slug
without a committed JSON file returns 404.

`GET /api/v1/websites/<slug>` is **public**: it returns the page the merchant
is publishing, so this template renders without a token. Only the *listing*
(`GET /api/v1/websites`) requires the `website.view` capability, and that is
used solely to pre-render slugs at build time — `dynamicParams = true` renders
anything else on demand, so leaving `WEBSITE_API_TOKEN` unset is fine.

With `SITE_REVALIDATE=0` an edit in the Super App shows on the next refresh.
Raise it in production so every visit doesn't hit the API.

### The root URL

`/` serves **nothing** by default and returns a 404. Every site is reached at
its own `/<slug>`, so no merchant gets a shorter, more privileged address than
the rest — which is what hard-coding one slug at the root would do.

Set `DEFAULT_SITE=<slug>` only when a deployment serves a single merchant, e.g.
a per-domain deploy where `primocafe.com` should show that site at its root.

If the API is unreachable the template doesn't fail — it falls back to
`data/sites/`, and a slug it has never seen 404s as usual.

## Colours

```json
"brand": {
  "primary":   "#39261C",
  "secondary": "#F89E1F",
  "accent":    "#F01827"
}
```

`primary` and `secondary` define the brand; `accent` is the hover/call-out
colour. They're published as CSS variables on the page, and Tailwind's
`primo-*` colours read those variables. Text colours are computed, not
configured — `lib/format.js` measures each colour's luminance and picks black
or white for whatever sits on top, and a light `primary` flips the footer text
to dark automatically.

Because the `primo-*` colours are plain `var()` values, Tailwind opacity
modifiers like `bg-primo-primary/50` won't work on them. Use an explicit
overlay instead.

## Missing data

A section disappears rather than rendering an empty heading: no
`hero.headline`, no hero; no `offerings.items`, no menu; no `catering.heading`,
no catering section. `contact.formType` of `"No form, phone only"` drops the
contact section. Any empty image field draws a generated SVG placeholder, so a
half-filled site still looks intact instead of showing broken images.

## Images

Any image field takes a `/public` path (optimised by `next/image`), a full
remote URL, a data URI, or an empty string. Only `/public` paths go through the
optimiser — everything else renders unoptimised, so remote hosts don't need an
entry in `next.config.mjs`.

This holds whichever source the data came from. A record stored in the API can
say `/images/header-logo.png` just as a JSON file can — the path is resolved by
**whoever serves the page**, which is always this project. So the artwork stays
in `public/images/` where it belongs; the API stores the reference, not the
bytes. `scripts/seed_websites.py` in the API repo imports the demo JSONs exactly this way, which is
why `/primo-cafe` comes out of the API with its real logo, hero photo and
selling-point icons intact.

Images a merchant adds through the Super App are either a URL they pasted or
an upload. Uploads are stored by the API (`POST /api/v1/websites/assets`) and
saved in the answers as `/api/v1/websites/assets/…`; `lib/sites.js` rewrites
that onto `WEBSITE_API_URL`'s origin, and the API serves the file publicly.
Older records may still hold an embedded `data:` URI — those keep working.

## Reviews, SEO and structured data

- **Reviews** render when a site has quoted reviews, a rating line or a widget.
  A pasted widget (`social.reviewsWidget`, e.g. Trustindex) is injected under
  the heading; otherwise a "Read our reviews on Google" button links to
  `social.reviewsUrl` or a Google Maps search for the business.
- **SEO**: `meta.title`, `meta.description`, `meta.ogTitle`,
  `meta.ogDescription`, `meta.keywords` and `meta.siteUrl` (canonical URL).
- **JSON-LD**: `meta.jsonLd` when it parses, otherwise a `Restaurant` block is
  generated from the business details (`lib/metadata.js`).

## Forms

The contact and catering forms are still front-end only: they show a thank-you
message on submit. Wire them to a route handler under `app/api/` or an email
service to receive submissions. `contact.formEmail` is carried in the data
ready for that.

## The /admin visual editor

Every site has a visual editor at **`/<slug>/admin`** — nothing links to it;
you add `/admin` to the site's URL. It is the same editor the Super App uses
for cloned sites (layers, style, widgets, theme, pages, accessibility).

- **Access**: a per-website password, set in the Super App (key icon in the
  My Websites list). Signing in gives a token for that one website only.
- **Template mode → edited mode**: until the first save a site is built from
  its form answers as usual. The editor opens on a snapshot of that page
  (`/<slug>/admin/source` renders it in "snapshot mode"). The first save stores
  the page as HTML in the API (`/websites/<slug>/content`) and from then on
  `/<slug>` serves the stored page (`components/EditedPage.js`); pages added in
  the editor are served at `/<slug>/<page>`.
- **After that, the form no longer changes the page** (brand fonts/colours,
  SEO title/description and JSON-LD still come from the form). "Rebuild from
  form" in the Super App discards the edits.
- **No deploys**: a save is one API write; the next request shows it.
- **Kill switch**: `SITE_EDITOR_ENABLED=false` hides /admin and ignores stored
  edits — every site renders from its form answers again, edits kept.
- **Editor source** lives in the Super App; `npm run sync-editor` copies it into
  `components/editor/`, `lib/site-builder/` and `public/sb-*` (see
  `scripts/sync-editor.cjs`).

## Running it

```bash
npm install
npm run dev     # http://localhost:5050
npm run build   # static pages for every slug
```

The port is pinned to **5050** in `package.json` so this project can never take
the one the Super App wants. The three services sit on:

| Port   | What                                        |
| ------ | ------------------------------------------- |
| `3000` | Innowi Super App API (websites included)    |
| `5050` | this template — the public sites            |
| `3001` | the Super App (frontend)                    |

If you move this project, set `NEXT_PUBLIC_SITE_TEMPLATE_URL` in the Super App's
`.env.local` so its "Visit site" buttons follow.
