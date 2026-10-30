import SiteHead from "./SiteHead";

import Header from "./Header";
import Hero from "./Hero";
import About from "./About";
import MenuHighlights from "./MenuHighlights";
import WhyChooseUs from "./WhyChooseUs";
import Catering from "./Catering";
import Testimonials from "./Testimonials";
import Contact from "./Contact";
import Footer from "./Footer";

/**
 * One slug's whole page. Both routes (/ and /[slug]) render this — the only
 * difference between two sites is the JSON handed in as `site`.
 *
 * A section drops out when its data is missing, so a half-filled form still
 * produces a clean page rather than an empty heading.
 */
export default function SitePage({ site }) {
  const { hero, about, offerings, social, catering, contact } = site;
  const hasReviews = social.reviews.length > 0 || Boolean(social.ratingText) || Boolean(social.reviewsWidget);

  return (
    <>
      {/* Fonts, brand colours and JSON-LD. Left out of the /admin snapshot,
          which carries the page body only — see components/EditedPage.js. */}
      {!site.snapshot && <SiteHead site={site} />}

      <Header site={site} />

      <main id="top">
        {hero.headline && <Hero site={site} />}
        {about.heading && <About site={site} />}
        {offerings.items.length > 0 && <MenuHighlights site={site} />}
        {social.points.length > 0 && <WhyChooseUs site={site} />}
        {catering.heading && <Catering site={site} />}
        {hasReviews && <Testimonials site={site} />}
        {contact.formType !== "No form, phone only" && <Contact site={site} />}
      </main>

      <Footer site={site} />
    </>
  );
}
