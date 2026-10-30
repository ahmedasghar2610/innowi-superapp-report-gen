"use client";

import { motion } from "framer-motion";

// Mirrors the original Elementor/ElementsKit "animated-slow" scroll
// animations (fadeInLeft / fadeInDown / fadeInUp), including their
// distance, duration and stagger delays, using Framer Motion's
// whileInView so it triggers once as each element scrolls into view.
const VARIANTS = {
  fadeInUp: {
    hidden: { opacity: 0, y: 60 },
    visible: { opacity: 1, y: 0 },
  },
  fadeInDown: {
    hidden: { opacity: 0, y: -60 },
    visible: { opacity: 1, y: 0 },
  },
  fadeInLeft: {
    hidden: { opacity: 0, x: -60 },
    visible: { opacity: 1, x: 0 },
  },
};

// Maps a plain tag name (string) to its Framer Motion equivalent.
// Pass a plain tag name via `as` (defaults to "div").
export default function AnimateIn({
  animation = "fadeInUp",
  delay = 0,
  duration = 0.8,
  className,
  as = "div",
  still = false,
  children,
  ...rest
}) {
  // `still`: the /admin snapshot. The page is saved as plain HTML, so the
  // animation is written as data-sb-* attributes that public/sb-effects.js
  // plays instead of Framer Motion (which also leaves opacity:0 inline).
  if (still) {
    const Tag = as;
    return (
      <Tag
        {...rest}
        className={className}
        data-sb-anim={animation}
        data-sb-delay={delay || undefined}
        data-sb-duration={Math.round(duration * 1000)}
      >
        {children}
      </Tag>
    );
  }

  const variant = VARIANTS[animation] ?? VARIANTS.fadeInUp;
  const MotionTag = motion[as] ?? motion.div;

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      variants={variant}
      transition={{ duration, delay: delay / 1000, ease: "easeOut" }}
    >
      {children}
    </MotionTag>
  );
}
