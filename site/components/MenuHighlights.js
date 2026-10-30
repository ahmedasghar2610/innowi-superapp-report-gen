import SmartImage from "./SmartImage";
import { BellIcon } from "./icons";
import AnimateIn from "./AnimateIn";
import { bind, bindHref, bindItem, bindList, bindSrc } from "@/lib/bind";

export default function MenuHighlights({ site }) {
  const { offerings, orderUrl, labels } = site;

  return (
    <section id="menu" className="section">
      <div className="mb-10 text-center">
        <span className="eyebrow justify-center">
          <BellIcon /> <span {...bind(site, "offerings.eyebrow")}>{labels.menu.eyebrow}</span>
        </span>
        <h2 className="text-4xl font-bold md:text-6xl" {...bind(site, "offerings.heading")}>{offerings.heading}</h2>
        {offerings.intro && (
          <p className="mx-auto mt-4 max-w-2xl text-base text-primo-text md:text-lg" {...bind(site, "offerings.intro")}>{offerings.intro}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2" {...bindList(site, "offerings.items")}>
        {offerings.items.map((item, i) => (
          // Two per row share a stagger delay — the original Elementor cadence.
          <AnimateIn
            still={site.snapshot}
            animation="fadeInUp"
            delay={(Math.floor(i / 2) + 1) * 100}
            key={(item.name || "item") + i}
            {...bindItem(site)}
          >
            <a
              href={orderUrl}
              className="hover-card hover-card-from-left flex items-center gap-5 rounded-md border border-dashed border-[#c9c9c9] bg-primo-gray px-6 py-5 transition-colors"
            >
              <SmartImage
                src={item.image}
                alt={item.name || ""}
                label={item.name || "Dish"}
                bind={bindSrc(site, ".image")}
                width={92}
                height={71}
                className="h-16 w-[92px] shrink-0 object-contain"
              />
              {/* Photo, name and a line about the dish. Prices are deliberately
                  not shown — they go stale faster than anything else on a menu,
                  and the ordering link is the source of truth for them. */}
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-bold text-black" {...bind(site, ".name")}>{item.name}</h3>
                {item.description && (
                  <p className="mt-1 text-sm leading-relaxed text-primo-text" {...bind(site, ".description")}>
                    {item.description}
                  </p>
                )}
                {labels.menu.cardCta && (
                  <span className="mt-2 inline-block text-sm font-semibold text-primo-accent">
                    <span {...bind(site, "offerings.cardCta")}>{labels.menu.cardCta}</span> →
                  </span>
                )}
              </div>
            </a>
          </AnimateIn>
        ))}
      </div>

      <div className="mt-10 text-center">
        <a href={offerings.ctaLink || orderUrl} className="btn-dark" {...bindHref(site, "offerings.ctaLink")} {...bind(site, "offerings.ctaLabel")}>
          {labels.menu.cta}
        </a>
      </div>
    </section>
  );
}
