import SmartImage from "./SmartImage";
import { BellIcon } from "./icons";
import AnimateIn from "./AnimateIn";
import { bind, bindHref, bindSrc } from "@/lib/bind";

export default function About({ site }) {
  const { about, orderUrl, labels } = site;

  return (
    <section id="about" className="section grid grid-cols-1 items-center gap-12 md:grid-cols-2">
      <AnimateIn still={site.snapshot} animation="fadeInLeft" className="overflow-hidden rounded-lg">
        <SmartImage
          src={about.image}
          alt={about.imageAlt || about.heading || "About"}
          label="About image"
          bind={bindSrc(site, "about.image")}
          width={1360}
          height={1020}
          className="h-full w-full object-cover"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
      </AnimateIn>

      <div>
        <AnimateIn still={site.snapshot} animation="fadeInDown" as="span" className="eyebrow">
          <BellIcon /> <span {...bind(site, "about.eyebrow")}>{labels.about.eyebrow}</span>
        </AnimateIn>
        <AnimateIn still={site.snapshot}
          animation="fadeInDown"
          as="h2"
          {...bind(site, "about.heading")}
          className="mb-4 text-3xl font-bold md:text-4xl"
        >
          {about.heading}
        </AnimateIn>
        <AnimateIn still={site.snapshot}
          animation="fadeInUp"
          as="p"
          {...bind(site, "about.story")}
          className="mb-6 text-base text-primo-text md:text-lg"
        >
          {about.story}
        </AnimateIn>
        <AnimateIn still={site.snapshot} animation="fadeInUp">
          <a href={about.ctaLink || orderUrl} className="btn-dark" {...bindHref(site, "about.ctaLink")} {...bind(site, "about.ctaLabel")}>
            {labels.about.cta}
          </a>
        </AnimateIn>
      </div>
    </section>
  );
}
