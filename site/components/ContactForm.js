"use client";

import { useState } from "react";
import FormField from "./FormField";

const fieldClasses =
  "rounded-md border border-black/15 px-4 py-3 text-sm focus:border-primo-accent focus:outline-none";

/** `labels` is the site's resolved contact wording (lib/labels.js resolveLabels). */
export default function ContactForm({ labels, phonePattern }) {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    // No backend is wired up yet. Hook this up to an API route or
    // email service (e.g. Resend) when you're ready to receive submissions.
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-lg bg-primo-cream p-6 text-center">
        <p className="font-semibold text-primo-primary">{labels.success}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-sb-form
      data-sb-success={labels.success}
      data-sb-success-class="rounded-lg bg-primo-cream p-6 text-center font-semibold text-primo-primary"
      className="flex flex-col gap-4"
    >
      {labels.fields.map((field) => (
        <FormField key={field.name} field={field} phonePattern={phonePattern} className={fieldClasses} />
      ))}
      <button type="submit" className="btn-dark">
        {labels.submit}
      </button>
    </form>
  );
}
