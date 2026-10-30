/** @type {import('tailwindcss').Config} */
/*
 * Colours are CSS custom properties, not literals. The actual values are
 * published on :root by app/layout.js, straight from site.config.js — so
 * `bg-primo-primary` follows whatever theme.primary is set to.
 *
 * Note: because these are plain var() colours (not <alpha-value> channels),
 * Tailwind opacity modifiers like `bg-primo-primary/50` won't work on them.
 * Use rgba()/an explicit overlay if you need transparency.
 */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./site.config.js",
  ],
  theme: {
    extend: {
      colors: {
        primo: {
          primary: "var(--primo-primary)",
          secondary: "var(--primo-secondary)",
          accent: "var(--primo-accent)",
          cream: "var(--primo-cream)",
          gray: "var(--primo-gray)",
          text: "var(--primo-text)",
          // Readable foreground colours, computed from the theme in lib/site.js
          "on-primary": "var(--primo-on-primary)",
          "on-secondary": "var(--primo-on-secondary)",
          "on-accent": "var(--primo-on-accent)",
        },
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
      },
    },
  },
  plugins: [],
};
