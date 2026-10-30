/* =============================================================================
 * lib/labels.js — the template's default wording.
 *
 * Every string here is copied verbatim from the original Primo Cafe site:
 * button text, navigation labels, section eyebrows and form copy.
 *
 * Sites imported from a website content .docx carry their own wording (the
 * copy is written per client), so these are now the FALLBACK: `resolveLabels`
 * below lays a site's own text over them, key by key, and anything a site
 * leaves empty keeps the wording here. Components read `site.labels`, never
 * this object directly. Icons are still fixed (components/icons.js).
 * ========================================================================== */

const labels = {
  nav: [
    { label: "Home", href: "#top" },
    { label: "About Us", href: "#about" },
    { label: "Menu", href: "order" }, // "order" = use the site's orderUrl
    { label: "Catering", href: "#catering" },
    { label: "Contact Us", href: "#contact" },
  ],

  header: {
    cta: "Order Online",
  },

  hero: {
    cta: "Order Priority Pickup (Direct)",
  },

  about: {
    eyebrow: "About us",
    cta: "Order Direct Delivery (Best Price)",
  },

  menu: {
    eyebrow: "Delicious Menu",
    cta: "View Full Menu & Order Direct",
  },

  why: {
    eyebrow: "Why choose us",
  },

  catering: {
    eyebrow: "Catering",
    formTitle: "Get a Quote",
    submit: "Request Catering",
    success:
      "Thanks! Your catering request has been noted. We'll be in touch shortly.",
    fields: {
      name: "Enter Your Name",
      email: "Enter Your Email",
      phone: "Enter Your Phone",
      people: "No. of People",
      message: "Message",
    },
  },

  testimonials: {
    eyebrow: "Testimonials",
  },

  contact: {
    heading: "Contact Us",
    submit: "Send Message",
    success: "Thanks for reaching out! We'll get back to you soon.",
    fields: {
      name: "Name",
      email: "Email",
      phone: "Phone No.",
      subject: "Subject",
      message: "Message",
    },
  },

  footer: {
    contactHeading: "Contact Us",
    linksHeading: "Quick Link",
    hoursHeading: "Opening time",
    quickLinks: [
      { label: "Home", href: "#top" },
      { label: "About Us", href: "#about" },
      { label: "Menu", href: "order" },
      { label: "Contact Us", href: "#contact" },
    ],
    rights: "All Rights Reserved",
  },

  reviews: {
    link: "Read our reviews on Google",
  },

  menuCard: {
    cta: "",
  },

  directions: {
    cta: "",
  },

  phonePattern: {
    pattern: "[0-9()#&+*-=.]+",
    title: "Only numbers and phone characters (#, -, *, etc) are accepted.",
  },
};

export default labels;

/* ------------------------------------------------------------ per-site text */

const text = (value) => (typeof value === "string" ? value.trim() : "");
const pick = (value, fallback) => text(value) || fallback;

/** `Home · About · Menu` -> ["Home", "About", "Menu"]. */
export function splitList(value) {
  return text(value)
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Rename a fixed link list positionally; extra or missing names keep the default. */
function renameLinks(links, names) {
  return links.map((link, i) => ({ ...link, label: names[i] || link.label }));
}

/* -------------------------------------------------------------- form fields
 * A form's fields arrive as one line: "Your name · Email · Phone · Event date ·
 * Time · Number of people · Message (pickup or delivery, dietary needs)".
 * Each is matched to an input type by its wording; text in brackets becomes
 * the hint inside the box.
 * ------------------------------------------------------------------------ */

const FIELD_KINDS = [
  ["email", /e-?mail/i],
  ["phone", /phone|mobile|\btel/i],
  ["date", /date|day\b/i],
  ["time", /\btime\b/i],
  ["people", /people|guests|headcount|number|party size|how many/i],
  ["subject", /subject|topic/i],
  ["message", /message|notes?|comments?|details|request/i],
  ["name", /name/i],
];

export function parseFormFields(value, fallback) {
  const items = splitList(value);
  if (!items.length) return fallback;
  const seen = new Set();
  const fields = [];
  for (const item of items) {
    const bracket = item.match(/^(.*?)\s*\((.+)\)\s*$/);
    const label = bracket ? bracket[1].trim() : item;
    const kind = (FIELD_KINDS.find(([, re]) => re.test(label)) || ["text"])[0];
    const key = seen.has(kind) ? `${kind}${fields.length}` : kind;
    seen.add(kind);
    fields.push({
      kind,
      name: key,
      label,
      placeholder: bracket ? `${label} (${bracket[2].trim()})` : label,
    });
  }
  return fields;
}

const CATERING_DEFAULT_FIELDS = [
  { kind: "name", name: "name", label: labels.catering.fields.name, placeholder: labels.catering.fields.name },
  { kind: "email", name: "email", label: labels.catering.fields.email, placeholder: labels.catering.fields.email },
  { kind: "phone", name: "phone", label: labels.catering.fields.phone, placeholder: labels.catering.fields.phone },
  { kind: "date", name: "date", label: "Event date", placeholder: "Event date" },
  { kind: "time", name: "time", label: "Time", placeholder: "Time" },
  { kind: "people", name: "people", label: labels.catering.fields.people, placeholder: labels.catering.fields.people },
  { kind: "message", name: "message", label: labels.catering.fields.message, placeholder: labels.catering.fields.message },
];

const CONTACT_DEFAULT_FIELDS = ["name", "email", "phone", "subject", "message"].map((kind) => ({
  kind,
  name: kind,
  label: labels.contact.fields[kind],
  placeholder: labels.contact.fields[kind],
}));

/**
 * The wording one site renders with: its own text where it has some, the
 * defaults above everywhere else. `raw` is the site's answer tree.
 */
export function resolveLabels(raw = {}) {
  const lbl = raw.labels || {};
  const hero = raw.hero || {};
  const about = raw.about || {};
  const offerings = raw.offerings || {};
  const social = raw.social || {};
  const catering = raw.catering || {};
  const contact = raw.contact || {};
  const footer = raw.footer || {};

  const navNames = splitList(lbl.nav);
  const quickNames = splitList(footer.quickLinks);

  return {
    nav: renameLinks(labels.nav, navNames),
    header: { cta: pick(lbl.headerCta, labels.header.cta) },
    hero: { cta: pick(hero.ctaLabel, labels.hero.cta) },
    about: { eyebrow: pick(about.eyebrow, labels.about.eyebrow), cta: pick(about.ctaLabel, labels.about.cta) },
    menu: {
      eyebrow: pick(offerings.eyebrow, labels.menu.eyebrow),
      cta: pick(offerings.ctaLabel, labels.menu.cta),
      cardCta: pick(offerings.cardCta, labels.menuCard.cta),
    },
    why: { eyebrow: pick(social.eyebrow, labels.why.eyebrow) },
    catering: {
      eyebrow: pick(catering.eyebrow, labels.catering.eyebrow),
      cta: text(catering.ctaLabel),
      formTitle: pick(catering.formTitle, labels.catering.formTitle),
      submit: pick(catering.submitLabel, labels.catering.submit),
      success: pick(catering.success, labels.catering.success),
      fields: parseFormFields(catering.formFields, CATERING_DEFAULT_FIELDS),
    },
    testimonials: {
      eyebrow: pick(social.reviewsEyebrow, labels.testimonials.eyebrow),
      link: pick(social.reviewsLinkLabel, labels.reviews.link),
    },
    contact: {
      heading: pick(contact.heading, labels.contact.heading),
      submit: pick(contact.submitLabel, labels.contact.submit),
      success: pick(contact.success, labels.contact.success),
      fields: parseFormFields(contact.formFields, CONTACT_DEFAULT_FIELDS),
      directions: pick(contact.directionsLabel, labels.directions.cta),
    },
    footer: {
      ...labels.footer,
      // The footer list has no Catering entry, so names are matched by their
      // position in the full nav order rather than one-for-one.
      quickLinks: quickNames.length
        ? labels.nav.map((link, i) => ({ ...link, label: quickNames[i] || link.label })).slice(0, quickNames.length)
        : navNames.length
          ? labels.footer.quickLinks.map((link) => {
              const i = labels.nav.findIndex((n) => n.href === link.href);
              return { ...link, label: navNames[i] || link.label };
            })
          : labels.footer.quickLinks,
      rights: pick(footer.rights, labels.footer.rights),
    },
    phonePattern: labels.phonePattern,
  };
}
