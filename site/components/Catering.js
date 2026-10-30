import { telHref } from "@/lib/format";
import { BellIcon, PhoneIcon } from "./icons";
import CateringForm from "./CateringForm";
import { bind } from "@/lib/bind";

export default function Catering({ site }) {
  const { catering, business, contact, labels } = site;
  const showForm = contact.formType === "Contact + catering/quote form";

  return (
    <section id="catering">
      <div className="section grid grid-cols-1 items-center gap-12 md:grid-cols-2">
        <div>
          <span className="eyebrow">
            <BellIcon /> <span {...bind(site, "catering.eyebrow")}>{labels.catering.eyebrow}</span>
          </span>
          <h2 className="mb-4 text-4xl font-bold md:text-6xl" {...bind(site, "catering.heading")}>{catering.heading}</h2>
          <p className="mb-6 text-base text-primo-text md:text-lg" {...bind(site, "catering.body")}>{catering.body}</p>
          {business.phone && (
            <a href={catering.ctaLink || telHref(business.phone)} className="btn">
              <PhoneIcon /> {labels.catering.cta || business.phone}
            </a>
          )}
        </div>

        {showForm && (
          <div className="rounded-2xl bg-primo-accent p-6 md:p-8">
            <h2 className="mb-6 text-center text-3xl font-bold text-primo-on-accent">
              {labels.catering.formTitle}
            </h2>
            <CateringForm labels={labels.catering} phonePattern={labels.phonePattern} />
          </div>
        )}
      </div>
    </section>
  );
}
