import { multiline } from "@/lib/format";
import SmartImage from "./SmartImage";
import { bind, bindHref, bindSrc } from "@/lib/bind";

export default function Hero({ site }) {
  const { hero, orderUrl, labels } = site;

  return (
    <section className="relative isolate flex min-h-[500px] items-center overflow-hidden px-3 py-16 md:min-h-[700px] md:py-0">
      <SmartImage
        src={hero.image}
        alt={hero.imageAlt || ""}
        label="Hero image"
        bind={bindSrc(site, "hero.image")}
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover object-[center_bottom]"
      />
      {/* Left-side gradient so the white headline stays readable over the photo */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/70 via-black/35 to-transparent" />

      <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-6">
        <h1 className="max-w-2xl text-5xl font-bold leading-tight text-white md:text-7xl" {...bind(site, "hero.headline")}>
          {multiline(hero.headline)}
        </h1>
        {hero.subtext && (
          <p className="max-w-xl text-base text-white/90 md:text-lg" {...bind(site, "hero.subtext")}>
            {hero.subtext}
          </p>
        )}
        <a href={hero.ctaLink || orderUrl} className="btn" {...bindHref(site, "hero.ctaLink")} {...bind(site, "hero.ctaLabel")}>
          {labels.hero.cta}
        </a>
      </div>
    </section>
  );
}
