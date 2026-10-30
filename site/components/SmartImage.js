import Image from "next/image";
import { imgSrc, isLocalImage } from "@/lib/format";

/**
 * A drop-in for next/image that accepts anything the config might hold:
 * a /public path, a remote URL, a data URI, or nothing at all.
 *
 * Local paths go through next/image's optimiser; everything else renders
 * unoptimised so remote hosts don't need allow-listing in next.config.mjs.
 */
export default function SmartImage({
  src,
  alt = "",
  label,
  width,
  height,
  fill = false,
  className,
  sizes,
  priority = false,
  bind = {},
}) {
  const resolved = imgSrc(src, label || alt || "Image", width || 800, height || 600);
  const local = isLocalImage(resolved);

  const common = {
    src: resolved,
    alt,
    className,
    sizes,
    priority,
    unoptimized: !local,
  };

  if (fill) return <Image {...common} {...bind} fill />;
  return <Image {...common} {...bind} width={width} height={height} />;
}
