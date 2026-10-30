import { BellIcon, StarIcon } from "./icons";
import ReviewsWidget from "./ReviewsWidget";
import { bind, bindItem, bindList } from "@/lib/bind";

/**
 * Reviews. Three ways to fill it, in order of preference:
 *   - a pasted reviews widget (live Google reviews via Trustindex etc.)
 *   - otherwise a "Read our reviews on Google" button to the listing
 *   - reviews typed into the form, shown as cards (older sites)
 * Imported sites never quote reviews in copy — just the heading, the rating
 * line and the widget or button.
 */
export default function Testimonials({ site }) {
  const { social, labels, business, contact } = site;
  const reviewsUrl =
    social.reviewsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      [business.name, business.address, business.city].filter(Boolean).join(", ") ||
        contact.mapAddress ||
        ""
    )}`;
  const showButton = !social.reviewsWidget && (social.reviews.length === 0 || Boolean(social.reviewsUrl));

  return (
    <section id="reviews" className="bg-primo-cream">
      <div className="section">
        <div className="mb-10 text-center">
          <span className="eyebrow justify-center">
            <BellIcon /> <span {...bind(site, "social.reviewsEyebrow")}>{labels.testimonials.eyebrow}</span>
          </span>
          <h2 className="text-4xl font-bold md:text-6xl" {...bind(site, "social.reviewsHeading")}>{social.reviewsHeading}</h2>
          {social.ratingText && (
            <p className="mt-3 text-sm text-primo-text md:text-base" {...bind(site, "social.ratingText")}>{social.ratingText}</p>
          )}
        </div>

        {social.reviewsWidget && <ReviewsWidget code={social.reviewsWidget} />}

        {social.reviews.length > 0 && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2" {...bindList(site, "social.reviews")}>
            {social.reviews.map((review, idx) => (
              <div key={(review.name || "review") + idx} className="rounded-lg bg-white p-6 shadow-sm" {...bindItem(site)}>
                <div className="mb-3 flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <StarIcon
                      key={i}
                      className={
                        i < (Number(review.rating) || 5)
                          ? "text-primo-secondary"
                          : "text-black/15"
                      }
                    />
                  ))}
                </div>
                <p className="mb-4 text-sm text-primo-text" {...bind(site, ".text")}>{review.text}</p>
                <p className="font-bold text-black" {...bind(site, ".name")}>{review.name}</p>
              </div>
            ))}
          </div>
        )}

        {showButton && (
          <div className="mt-8 text-center">
            <a href={reviewsUrl} target="_blank" rel="noopener noreferrer" className="btn-dark">
              <StarIcon /> {labels.testimonials.link}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
