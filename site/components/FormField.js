/**
 * One input of a site-configured form. The field list comes from the site
 * (see parseFormFields in lib/labels.js); `kind` picks the input type.
 */
export default function FormField({ field, className, phonePattern, dateTimeLabels = false }) {
  const common = { name: field.name, className, "aria-label": field.label };

  switch (field.kind) {
    case "email":
      return <input type="email" placeholder={field.placeholder} required {...common} />;
    case "phone":
      return (
        <input
          type="tel"
          placeholder={field.placeholder}
          required
          pattern={phonePattern?.pattern}
          title={phonePattern?.title}
          {...common}
        />
      );
    case "date":
    case "time":
      // Date/time inputs can't show a placeholder, so the label sits inside
      // the box as a prefix instead.
      return dateTimeLabels ? (
        <label className={`${className} flex items-center gap-2`}>
          <span className="shrink-0 opacity-80">{field.label}</span>
          <input type={field.kind} name={field.name} required className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
      ) : (
        <input type={field.kind} required {...common} />
      );
    case "people":
      return <input type="number" min="1" placeholder={field.placeholder} required {...common} />;
    case "message":
      return <textarea placeholder={field.placeholder} rows={4} {...common} />;
    case "subject":
      return <input type="text" placeholder={field.placeholder} required {...common} />;
    default:
      return <input type="text" placeholder={field.placeholder} {...common} />;
  }
}
