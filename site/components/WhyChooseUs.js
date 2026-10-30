import SmartImage from "./SmartImage";
import { BellIcon } from "./icons";
import AnimateIn from "./AnimateIn";
import { bind, bindItem, bindList, bindSrc } from "@/lib/bind";

export default function WhyChooseUs({ site }) {
  const { social, labels } = site;

  return (
    <section id="why" className="section">
      <div className="mb-10 text-center">
        <span className="eyebrow justify-center">
          <BellIcon /> <span {...bind(site, "social.eyebrow")}>{labels.why.eyebrow}</span>
        </span>
        <h2 className="text-4xl font-bold md:text-6xl" {...bind(site, "social.heading")}>{social.heading}</h2>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4" {...bindList(site, "social.points")}>
        {social.points.map((feature, i) => (
          <AnimateIn
            still={site.snapshot}
            animation="fadeInDown"
            delay={(i + 1) * 100}
            key={(feature.title || "feature") + i}
            {...bindItem(site)}
            className="hover-card hover-card-from-top rounded-md bg-primo-gray px-8 py-10 text-center"
          >
            <div className="mx-auto mb-4 flex h-[112px] w-[112px] items-center justify-center rounded-full bg-white">
              {feature.icon ? (
                <SmartImage
                  src={feature.icon}
                  alt=""
                  label={feature.title || "Icon"}
                  bind={bindSrc(site, ".icon")}
                  width={80}
                  height={80}
                  className="h-20 w-20 object-contain"
                />
              ) : (
                // Only when no icon image is supplied at all.
                <span className="text-[44px] leading-none" {...bind(site, ".emoji")}>{feature.emoji || "★"}</span>
              )}
            </div>
            <h3 className="mb-2 text-xl font-bold text-black" {...bind(site, ".title")}>{feature.title}</h3>
            <p className="text-base text-primo-text" {...bind(site, ".description")}>{feature.description}</p>
          </AnimateIn>
        ))}
      </div>
    </section>
  );
}
