/**
 * Choices offered by the website form's pickers (font, emoji, form fields,
 * country). The stored answers are still plain text — exactly what the site
 * template already reads — so a value typed by hand before these pickers
 * existed keeps working, and a custom value can still be entered.
 */

/* -------------------------------------------------------------------- fonts
 * Google Fonts only: the site template fetches whatever family is named here
 * from Google Fonts (nextjs-site lib/sites.js googleFamilies), so a system
 * font like "Georgia" would be requested and fail.
 */
export type FontCategory = "Sans serif" | "Serif" | "Display" | "Handwriting";

export interface FontOption {
  family: string;
  category: FontCategory;
}

const sans = ["Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Work Sans", "DM Sans",
  "Source Sans 3", "Barlow", "Barlow Condensed", "Oswald", "Rubik", "Mulish", "Karla", "Manrope", "Outfit", "Josefin Sans"];
const serif = ["Playfair Display", "Merriweather", "Lora", "Libre Baskerville", "Cormorant Garamond", "EB Garamond",
  "Crimson Text", "DM Serif Display", "Bitter", "Roboto Slab", "Zilla Slab"];
const display = ["Bebas Neue", "Anton", "Abril Fatface", "Alfa Slab One", "Righteous", "Fredoka", "Lobster", "Bungee"];
const hand = ["Pacifico", "Dancing Script", "Caveat", "Great Vibes", "Satisfy", "Kaushan Script", "Amatic SC"];

export const FONT_OPTIONS: FontOption[] = [
  ...sans.map((family) => ({ family, category: "Sans serif" as const })),
  ...serif.map((family) => ({ family, category: "Serif" as const })),
  ...display.map((family) => ({ family, category: "Display" as const })),
  ...hand.map((family) => ({ family, category: "Handwriting" as const })),
];

export const FONT_CATEGORIES: FontCategory[] = ["Sans serif", "Serif", "Display", "Handwriting"];

/** One Google Fonts stylesheet for the given families (regular weight — enough to preview). */
export function googleFontsHref(families: string[]): string {
  const params = families.map((f) => `family=${f.trim().replace(/\s+/g, "+")}`).join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/* -------------------------------------------------------------------- emoji */
export const EMOJI_GROUPS: { label: string; emoji: string[] }[] = [
  { label: "Food", emoji: ["🍕", "🍔", "🌮", "🌯", "🥗", "🍣", "🍜", "🍝", "🥘", "🍗", "🥩", "🍤", "🥐", "🥞", "🧇", "🍳", "🍰", "🧁", "🍩", "🍦"] },
  { label: "Drinks", emoji: ["☕", "🍵", "🧋", "🥤", "🍷", "🍺", "🍹", "🍸", "🥂", "🧃"] },
  { label: "Quality", emoji: ["⭐", "🏆", "👨‍🍳", "🔥", "🌱", "🥬", "🌶️", "🧄", "💯", "✅", "❤️", "✨", "🧼", "🧊"] },
  { label: "Service", emoji: ["🚚", "🛵", "🛍️", "📦", "⏱️", "🕒", "📍", "🅿️", "💳", "📱", "🎉", "🎂", "👨‍👩‍👧", "🐶", "♿", "☀️", "🪑", "🎵"] },
];

/* --------------------------------------------------------------- form fields
 * The template recognises a field by its wording (email, phone, date, …), so
 * these presets are phrased the way it expects; any other label still works
 * as a plain text box.
 */
export const CONTACT_FIELD_PRESETS = ["Name", "Email", "Phone", "Subject", "Message"];
export const CATERING_FIELD_PRESETS = ["Name", "Email", "Phone", "Event date", "Time", "Number of people", "Message"];

/** The template splits these lists on "·" (also • and |). */
export const LIST_SEPARATOR = " · ";

export function splitFieldList(value: string): string[] {
  return value
    .split(/\s*[·•|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ----------------------------------------------------------------- countries */
export const COUNTRIES = [
  "United States", "Canada", "Mexico", "United Kingdom", "Ireland", "Australia", "New Zealand",
  "Pakistan", "India", "United Arab Emirates", "Saudi Arabia", "Qatar", "Germany", "France", "Spain",
  "Italy", "Netherlands", "Portugal", "Turkey", "Singapore", "Malaysia", "Philippines", "South Africa",
];
