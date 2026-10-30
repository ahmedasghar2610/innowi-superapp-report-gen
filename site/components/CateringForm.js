"use client";

import { useState } from "react";
import FormField from "./FormField";

const fieldClasses =
  "col-span-1 rounded-md border border-primo-on-accent bg-transparent px-4 py-3 text-sm text-primo-on-accent placeholder-primo-on-accent focus:outline-none focus:ring-2 focus:ring-primo-on-accent [color-scheme:dark]";

/** `labels` is the site's resolved catering wording (lib/labels.js resolveLabels). */
export default function CateringForm({ labels, phonePattern }) {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    // No backend is wired up yet. Hook this up to an API route or
    // email service (e.g. Resend) when you're ready to receive submissions.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-lg bg-white/10 p-6 text-center">
        <p className="font-semibold text-primo-on-accent">{labels.success}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-sb-form
      data-sb-success={labels.success}
      data-sb-success-class="rounded-lg bg-white/10 p-6 text-center font-semibold text-primo-on-accent"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {labels.fields.map((field) => (
        <FormField
          key={field.name}
          field={field}
          phonePattern={phonePattern}
          dateTimeLabels
          className={field.kind === "message" ? `${fieldClasses} sm:col-span-2` : fieldClasses}
        />
      ))}
      <button type="submit" className="btn-dark col-span-1 sm:col-span-2">
        {labels.submit}
      </button>
    </form>
  );
}
