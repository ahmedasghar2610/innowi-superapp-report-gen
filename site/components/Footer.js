import { multiline, telHref, luminance, fullAddress } from "@/lib/format";
import SmartImage from "./SmartImage";
import { bind, bindHref } from "@/lib/bind";
import {
  FacebookIcon,
  InstagramIcon,
  TwitterIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
} from "./icons";

export default function Footer({ site }) {
  const { footer, brand, business, labels } = site;
  const name = business.name || "";

  // On a light main colour, white-ish footer text would be unreadable.
  const lightBg = luminance(brand.primary) > 0.183;
  const bodyText = lightBg ? "text-black/70" : "text-white/80";
  const hoverText = lightBg ? "hover:text-black" : "hover:text-white";
  const hairline = lightBg ? "border-black/15" : "border-white/30";

  const socials = [
    { href: footer.facebook, label: "Facebook", Icon: FacebookIcon },
    { href: footer.instagram, label: "Instagram", Icon: InstagramIcon },
    { href: footer.twitter, label: "X", Icon: TwitterIcon },
  ].filter((s) => s.href);

  const quickLinks = labels.footer.quickLinks.map((l) => ({
    label: l.label,
    href: l.href === "order" ? site.orderUrl : l.href,
  }));

  const address = fullAddress(business);

  return (
    <footer className={`bg-primo-primary ${bodyText}`}>
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-5 py-16 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <a href="#top" aria-label={name}>
            {brand.logo ? (
              <SmartImage
                src={brand.logo}
                alt={name}
                label="Logo"
                width={80}
                height={80}
                className="mb-4 h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <span className="mb-4 block font-heading text-3xl font-bold text-primo-secondary" {...bind(site, "business.name")}>
                {name}
              </span>
            )}
          </a>
          <p className="text-sm leading-relaxed" {...bind(site, "footer.about")}>{footer.about}</p>
        </div>

        <div>
          <h2 className="mb-4 text-xl font-bold text-primo-secondary">
            {labels.footer.contactHeading}
          </h2>
          <ul className="space-y-3 text-sm">
            {address && (
              <li className="flex items-start gap-2">
                <MapPinIcon className="mt-1 shrink-0" />
                {site.snapshot ? (
                  // Two answers make up the address; each is bound on its own.
                  <span>
                    <span {...bind(site, "business.address")}>{multiline(business.address)}</span>
                    {business.address && business.city && <br />}
                    <span {...bind(site, "business.city")}>{multiline(business.city)}</span>
                  </span>
                ) : (
                  <span>{multiline(address)}</span>
                )}
              </li>
            )}
            {business.phone && (
              <li className="flex items-center gap-2">
                <PhoneIcon className="shrink-0" />
                <a href={telHref(business.phone)} className={hoverText} {...bindHref(site, "business.phone", "tel")} {...bind(site, "business.phone")}>
                  {business.phone}
                </a>
              </li>
            )}
            {business.email && (
              <li className="flex items-center gap-2">
                <MailIcon className="shrink-0" />
                <a href={`mailto:${business.email}`} className={hoverText} {...bindHref(site, "business.email", "mailto")} {...bind(site, "business.email")}>
                  {business.email}
                </a>
              </li>
            )}
          </ul>
        </div>

        <div>
          <h2 className="mb-4 text-xl font-bold text-primo-secondary">
            {labels.footer.linksHeading}
          </h2>
          <ul className="space-y-3 text-sm">
            {quickLinks.map((link) => (
              <li key={link.label}>
                <a href={link.href} className={hoverText}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="mb-4 text-xl font-bold text-primo-secondary">
            {labels.footer.hoursHeading}
          </h2>
          <p className="mb-4 text-sm" {...bind(site, "business.hours")}>{multiline(business.hours)}</p>
          {socials.length > 0 && (
            <div className="flex gap-3">
              {socials.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border ${hairline} hover:border-primo-accent hover:bg-primo-accent hover:text-primo-on-accent`}
                >
                  <Icon />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className={`border-t ${lightBg ? "border-black/10" : "border-white/10"} px-5 py-6 text-center text-sm`}
      >
        {footer.freshness && <p className="mb-2 text-xs opacity-80">{footer.freshness}</p>}
        © {new Date().getFullYear()} <span {...bind(site, "business.name")}>{name}</span>. <span {...bind(site, "footer.rights")}>{labels.footer.rights}</span>
        {footer.credit && ". "}
        {footer.credit && (
          <a
            href={footer.creditHref || "#"}
            className={`font-semibold text-primo-accent underline ${hoverText}`}
          >
            {footer.credit}
          </a>
        )}
      </div>
    </footer>
  );
}
