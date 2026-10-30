/* =============================================================================
 * site.config.js — the single source of truth for this template.
 *
 * Every piece of copy, every image, every colour on the site comes from this
 * file. Change it (or paste in a site-config.json exported from the vanilla
 * Site Builder) and the whole site re-skins — no component edits needed.
 *
 * Images: any `image` / `icon` / `logo` field accepts
 *   • a path under /public         → "/images/hero.jpg"
 *   • an absolute URL              → "https://…/photo.jpg"
 *   • a data URI                   → "data:image/png;base64,…"
 *   • an empty string              → a built-in SVG placeholder is drawn
 * ========================================================================== */

const ORDER_URL = "https://online-ordering.innowi.com/branch/primocafe";

const siteConfig = {
  /* ---------------------------------------------------------------- meta */
  meta: {
    siteName: "Primo Cafe",
    title: "Primo Cafe",
    description:
      "Primo Cafe is Lancaster's premier all-day diner, located in the Valley Central Shopping Center off Highway 14. Famous for our hearty Chorizo Burritos, authentic Menudo, and daily breakfast classics.",
    lang: "en-US",
    favicon: "/images/header-logo-150.png",
    appleIcon: "/images/header-logo-300.png",
  },

  /* --------------------------------------------------------------- theme */
  /* primary + secondary are the two colours that define the brand.        */
  theme: {
    primary: "#39261C", // main: header CTA, footer, dark buttons
    secondary: "#F89E1F", // secondary: accents, eyebrows, primary buttons
    accent: "#F01827", // highlight: hovers, quote card
    cream: "#F7F1E1", // testimonials background
    gray: "#F5F5F5", // card background
    text: "#484848", // body copy
    headingFont: '"Barlow Condensed", Impact, "Arial Narrow Bold", sans-serif',
    bodyFont: '"Roboto", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
    googleFonts: true,
    googleFontFamilies:
      "family=Barlow+Condensed:wght@400;500;600;700&family=Roboto:wght@400;500;700",
  },

  /* -------------------------------------------------------------- header */
  header: {
    logo: "/images/header-logo.png",
    ctaLabel: "Order Online",
    ctaHref: ORDER_URL,
    navLinks: [
      { label: "Home", href: "#top" },
      { label: "About Us", href: "#about" },
      { label: "Menu", href: ORDER_URL },
      { label: "Catering", href: "#catering" },
      { label: "Contact Us", href: "#contact" },
    ],
  },

  /* ---------------------------------------------------------------- hero */
  hero: {
    enabled: true,
    headline: "Lancaster's Favorite\nDiner off Highway 14",
    subtext:
      "Savor hearty, expertly crafted diner classics—from massive Chorizo Burritos to our famous Chicken Fried Steak. Skip the app fees and get your food faster.",
    ctaLabel: "Order Priority Pickup (Direct)",
    ctaHref: ORDER_URL,
    image: "/images/pancakes-hero-bg.jpg",
  },

  /* --------------------------------------------------------------- about */
  about: {
    enabled: true,
    eyebrow: "About us",
    heading: "Fresh, Flavorful Dining in Valley Central",
    body:
      "Located right in the Valley Central Shopping Center, Primo Cafe is your go-to spot for Antelope Valley's best comfort food. Whether you're commuting and need a quick breakfast, or sitting down for our signature Carne Asada Pizza, we prepare every meal with the finest ingredients. Support local and order directly through our official site.",
    ctaLabel: "Order Direct Delivery (Best Price)",
    ctaHref: ORDER_URL,
    image: "/images/restaurant-vibe.webp",
  },

  /* ---------------------------------------------------------------- menu */
  menu: {
    enabled: true,
    eyebrow: "Delicious Menu",
    heading: "Explore Antelope Valley's Favorite Comfort Food",
    ctaLabel: "View Full Menu & Order Direct",
    ctaHref: ORDER_URL,
    items: [
      { name: "Bac & Eggs", price: "$14.50", image: "/images/menu-item-placeholder.jpg" },
      { name: "Fish & Chips", price: "$18.45", image: "/images/menu-item-placeholder.jpg" },
      { name: "Chicken Fried Steak & Egg", price: "$18.25", image: "/images/menu-item-placeholder.jpg" },
      { name: "Menudo Large", price: "$17.95", image: "/images/menu-item-placeholder.jpg" },
      { name: "Chorizo Burrito", price: "$11.95", image: "/images/menu-item-placeholder.jpg" },
      { name: "Primo's Fajita Dinner", price: "$23.95", image: "/images/menu-item-placeholder.jpg" },
      { name: "Avocado & Chz Omelette", price: "$14.95", image: "/images/menu-item-placeholder.jpg" },
      { name: "Buffalo Chicken Pizza", price: "$16.75", image: "/images/menu-item-placeholder.jpg" },
    ],
  },

  /* ------------------------------------------------------------ features */
  features: {
    enabled: true,
    eyebrow: "Why choose us",
    heading: "Why Antelope Valley Chooses Primo",
    items: [
      {
        icon: "/images/icon-spotless-kitchen.png",
        emoji: "🧼",
        title: "Spotless Kitchen",
        description:
          "Dedicated to the highest safety and cleanliness standards in Lancaster.",
      },
      {
        icon: "/images/icon-local-vibe.png",
        emoji: "🏡",
        title: "Local Vibe",
        description:
          "A welcoming, no-frills diner atmosphere perfect for the whole family.",
      },
      {
        icon: "/images/icon-expert-griddle.png",
        emoji: "🍳",
        title: "Expert Griddle",
        description:
          "Masters of the kitchen serving up perfect omelettes and authentic fajitas.",
      },
      {
        icon: "/images/icon-av-catering.png",
        emoji: "🎉",
        title: "AV Event Catering",
        description:
          "Reliable, high-volume catering for your Antelope Valley meetings and parties.",
      },
    ],
  },

  /* ------------------------------------------------------------ catering */
  catering: {
    enabled: true,
    eyebrow: "Catering",
    heading: "Local Catering for Antelope Valley Events",
    body:
      "Hosting a team at the AV Event Center or planning a local office meeting? Fill out the form below for reliable catering and the best direct-to-restaurant rates.",
    phone: "+1 (661) 951-7288",
    formEnabled: true,
    formTitle: "Get a Quote",
    formButton: "Request Catering",
  },

  /* -------------------------------------------------------- testimonials */
  testimonials: {
    enabled: true,
    eyebrow: "Testimonials",
    heading: "What Lancaster is Saying",
    ratingText: "Google rating score: 4.0 of 5, based on 1013 reviews",
    items: [
      {
        name: "Paul Wilson",
        rating: 5,
        text:
          "Primo's is one of the best restaurants in Lancaster. I love their food and I love their customer service — they are great people.",
      },
      {
        name: "Luis Martinez",
        rating: 4,
        text:
          "Food was pretty good, service was fast and staff was friendly. Will definitely be back.",
      },
      {
        name: "Natasha Russell",
        rating: 5,
        text:
          "A must try for anyone looking for some pretty darn good tasty food as well as the warm cozy ambiance. The food is fresh and hot, nice hefty amount and good prices.",
      },
      {
        name: "Kevin Downing",
        rating: 5,
        text:
          "We enjoyed a nice family outing here. Very friendly waitress and nice homey atmosphere.",
      },
    ],
  },

  /* ------------------------------------------------------------- contact */
  contact: {
    enabled: true,
    heading: "Contact Us",
    formEnabled: true,
    mapQuery: "Primo Cafe, 44599 Vly Central Wy #6526, Lancaster, CA 93536, USA",
  },

  /* -------------------------------------------------------------- footer */
  footer: {
    about:
      "Primo Cafe is Lancaster's premier all-day diner, located in the Valley Central Shopping Center off Highway 14. Famous for our hearty Chorizo Burritos, authentic Menudo, and daily breakfast classics. Order via our Official Site for Priority Direct Pickup and zero 3rd-party markup fees.",
    address: "44599 Vly Central Wy #6526,\nLancaster, CA 93536",
    phone: "+1 (661) 951-7288",
    email: "",
    hours: "Monday to Sunday\n7 am–8:30 pm",
    facebook: "#",
    instagram: "#",
    twitter: "",
    quickLinks: [
      { label: "Home", href: "#top" },
      { label: "About Us", href: "#about" },
      { label: "Menu", href: ORDER_URL },
      { label: "Contact Us", href: "#contact" },
    ],
    credit: "Powered By Innowi Inc.",
    creditHref: "https://innowi.com/",
  },
};

export default siteConfig;
