import { fullAddress } from "@/lib/format";
import ContactForm from "./ContactForm";
import { bind } from "@/lib/bind";

export default function Contact({ site }) {
  const { contact, business, labels } = site;
  const query = contact.mapAddress || fullAddress(business) || business.name || "";
  const mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(
    String(query).replace(/\n/g, ", ")
  )}&t=m&z=14&output=embed&iwloc=near`;

  return (
    <section id="contact" className="section grid grid-cols-1 gap-12 md:grid-cols-2">
      <div>
        <h2 className="mb-6 text-3xl font-bold md:text-4xl" {...bind(site, "contact.heading")}>{labels.contact.heading}</h2>
        {contact.line && <p className="-mt-2 mb-6 text-base text-primo-text" {...bind(site, "contact.line")}>{contact.line}</p>}
        <ContactForm labels={labels.contact} phonePattern={labels.phonePattern} />
        {labels.contact.directions && (
          <a
            href={
              contact.directionsLink ||
              `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                String(query).replace(/\n/g, ", ")
              )}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="btn mt-6"
          >
            {labels.contact.directions}
          </a>
        )}
      </div>

      <div className="overflow-hidden rounded-lg">
        <iframe
          loading="lazy"
          src={mapSrc}
          title={String(query).replace(/\n/g, ", ")}
          className="h-full min-h-[350px] w-full border-0"
        />
      </div>
    </section>
  );
}
