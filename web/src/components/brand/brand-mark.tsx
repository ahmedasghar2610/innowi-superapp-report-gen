import { cn } from "@/lib/utils/cn";

/**
 * Innowi logo mark — Figma "LOGO OPTIONS-01c" / sidebar header
 * (Super-Admin-App · node 63:1130): a 32px Signal Blue tile (radius ≈ 7.6px)
 * carrying the white arch-and-dot glyph, drawn at 14.65 × 17.67 inside it.
 *
 * The glyph is redrawn here from the Figma geometry so the mark needs no
 * asset file. If the brand team supplies the exported vector, drop it at
 * `public/brand/innowi-mark.svg` and replace the <svg> below with an <img>.
 */
export type BrandMarkTone = "primary" | "dark" | "light";

const TONES: Record<BrandMarkTone, { tile: string; glyph: string }> = {
  primary: { tile: "bg-primary", glyph: "text-primary-foreground" },
  dark: { tile: "bg-[#1f1f1f]", glyph: "text-white" },
  light: { tile: "bg-white", glyph: "text-[#1f1f1f]" },
};

export function BrandMark({
  className,
  size = 32,
  tone = "primary",
  round = false,
}: {
  className?: string;
  size?: number;
  tone?: BrandMarkTone;
  /** Circular variant (Figma row 2 of the logo icons). */
  round?: boolean;
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn("grid shrink-0 place-items-center", t.tile, t.glyph, className)}
      style={{ width: size, height: size, borderRadius: round ? "9999px" : size * 0.239 }}
      aria-hidden
    >
      <InnowiGlyph style={{ width: size * 0.4578, height: size * 0.5523 }} />
    </span>
  );
}

/** The arch-and-dot glyph alone, in currentColor. viewBox matches the Figma glyph box. */
export function InnowiGlyph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 14.65 17.67" className={className} style={style} fill="none" aria-hidden>
      <path
        d="M1.6 16.07V7.35a5.725 5.725 0 0 1 11.45 0v8.72"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.325" cy="7.6" r="1.9" fill="currentColor" />
    </svg>
  );
}
