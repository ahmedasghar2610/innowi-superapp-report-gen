import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Command Center "Section head" (Figma Super-Admin-App · e.g. node 17:184):
 * title 16/24 semibold · optional 12/16 medium Signal Blue link · optional
 * right-aligned action slot. Used above every card group in the portal.
 */
export function SectionHead({
  title,
  description,
  link,
  href,
  scroll,
  action,
  className,
  as: Tag = "h2",
}: {
  title: string;
  description?: string;
  link?: string;
  href?: string;
  /** Passed to the link (tab-style links inside a workspace use `false`). */
  scroll?: boolean;
  action?: React.ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className={cn("flex flex-wrap items-start gap-2.5", className)}>
      <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <Tag className="text-base font-semibold leading-6 text-foreground">{title}</Tag>
        {link && href && (
          <Link href={href} scroll={scroll} className="text-xs font-medium leading-4 text-primary hover:underline">
            {link}
          </Link>
        )}
        {description && <p className="w-full text-xs leading-4 text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
