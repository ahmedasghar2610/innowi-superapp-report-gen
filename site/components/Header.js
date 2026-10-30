"use client";

import { useState } from "react";
import SmartImage from "./SmartImage";
import { MenuIcon, CloseIcon } from "./icons";
import { bind } from "@/lib/bind";

export default function Header({ site }) {
  const [open, setOpen] = useState(false);
  const name = site.business.name || "";

  // Wording comes from the site (falling back to lib/labels.js); "order" is
  // the token that points a link at the site's ordering URL.
  const labels = site.labels;
  const links = labels.nav.map((l) => ({
    label: l.label,
    href: l.href === "order" ? site.orderUrl : l.href,
  }));

  return (
    <header className="sticky top-0 z-50 bg-white shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3">
        <a href="#top" className="shrink-0" aria-label={name}>
          {site.brand.logo ? (
            <SmartImage
              src={site.brand.logo}
              alt={name}
              label="Logo"
              width={72}
              height={72}
              priority
              className="h-16 w-16 rounded-full object-cover md:h-[72px] md:w-[72px]"
            />
          ) : (
            <span className="font-heading text-3xl font-bold text-primo-primary" {...bind(site, "business.name")}>
              {name}
            </span>
          )}
        </a>

        <nav className="hidden items-center gap-8 md:flex">
          {links.map((link, i) => (
            <a
              key={link.label}
              href={link.href}
              className={
                i === 0
                  ? "text-base font-medium text-primo-accent"
                  : "text-base font-medium text-primo-primary transition-colors hover:text-primo-accent"
              }
            >
              {link.label}
            </a>
          ))}
        </nav>

        <a
          href={site.orderUrl}
          className="btn-dark hidden !rounded-lg !px-6 !py-3 !text-sm md:inline-flex"
          {...bind(site, "labels.headerCta")}
        >
          {labels.header.cta}
        </a>

        <button
          type="button"
          aria-label="Menu Toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          // In a saved /admin page React isn't running; sb-effects.js
          // toggles the menu from these attributes instead.
          data-sb-toggle="#sb-mobile-nav"
          data-sb-toggle-class="sb-open"
          className="text-primo-primary md:hidden"
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {(open || site.snapshot) && (
        <nav
          id="sb-mobile-nav"
          className={`border-t border-black/10 bg-white px-5 py-4 md:hidden ${site.snapshot ? "hidden" : ""}`}
        >
          <ul className="flex flex-col gap-4">
            {links.map((link, i) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={
                    i === 0
                      ? "block text-base font-medium text-primo-accent"
                      : "block text-base font-medium text-primo-primary hover:text-primo-accent"
                  }
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={site.orderUrl}
                className="btn-dark w-full !rounded-lg !px-6 !py-3 !text-sm"
                {...bind(site, "labels.headerCta")}
              >
                {labels.header.cta}
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
