// Accessibility widget settings model. This folder is copied verbatim into
// generated zips — keep every import relative (no "@/...").

export const STORAGE_KEY = "sb-a11y-v2";

export type Contrast = "" | "high" | "dark" | "light";
export type Saturation = "" | "low" | "high";
export type Font = "" | "readable" | "dyslexic";
export type TextAlign = "" | "left" | "center" | "right";

export type ProfileId =
  | "seizure"
  | "vision"
  | "adhd"
  | "cognitive"
  | "keyboard"
  | "screenreader";

export type Settings = {
  profile: ProfileId | "";
  /** Percent, 100–200 in steps of 10. */
  fontSize: number;
  /** 0 = site default, 1..3 = increasingly loose. */
  lineHeight: 0 | 1 | 2 | 3;
  letterSpacing: 0 | 1 | 2 | 3;
  textAlign: TextAlign;
  font: Font;
  highlightTitles: boolean;
  highlightLinks: boolean;
  focusHighlight: boolean;
  contrast: Contrast;
  monochrome: boolean;
  saturation: Saturation;
  invert: boolean;
  bigCursor: boolean;
  readingGuide: boolean;
  readingMask: boolean;
  stopAnimations: boolean;
  hideImages: boolean;
  muteSounds: boolean;
};

export const DEFAULTS: Settings = {
  profile: "",
  fontSize: 100,
  lineHeight: 0,
  letterSpacing: 0,
  textAlign: "",
  font: "",
  highlightTitles: false,
  highlightLinks: false,
  focusHighlight: false,
  contrast: "",
  monochrome: false,
  saturation: "",
  invert: false,
  bigCursor: false,
  readingGuide: false,
  readingMask: false,
  stopAnimations: false,
  hideImages: false,
  muteSounds: false,
};

export const PROFILES: Record<ProfileId, Partial<Settings>> = {
  seizure: { stopAnimations: true, saturation: "low", muteSounds: true },
  vision: { fontSize: 130, font: "readable", lineHeight: 1, highlightTitles: true, highlightLinks: true, contrast: "high" },
  adhd: { readingMask: true, stopAnimations: true, saturation: "low" },
  cognitive: { font: "readable", lineHeight: 2, letterSpacing: 1, highlightTitles: true, highlightLinks: true, bigCursor: true },
  keyboard: { focusHighlight: true, highlightLinks: true },
  screenreader: { stopAnimations: true, focusHighlight: true },
};

export function isDefault(settings: Settings): boolean {
  return (Object.keys(DEFAULTS) as Array<keyof Settings>).every((key) => settings[key] === DEFAULTS[key]);
}

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...DEFAULTS, ...parsed };
    merged.fontSize = Math.min(200, Math.max(100, Math.round(merged.fontSize / 10) * 10));
    return merged;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    if (isDefault(settings)) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota */
  }
}

/** Apply a profile preset on top of defaults (profiles are exclusive). */
export function withProfile(current: Settings, profile: ProfileId | ""): Settings {
  if (!profile || current.profile === profile) return { ...DEFAULTS };
  return { ...DEFAULTS, ...PROFILES[profile], profile };
}
