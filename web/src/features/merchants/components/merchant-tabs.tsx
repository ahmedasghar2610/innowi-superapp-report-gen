"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserCog, Users, MapPin, Layers, FileText, Tag, Plug, History, Palette, Search, Swords, Utensils, UtensilsCrossed, LoaderCircle, type LucideIcon } from "lucide-react";
import { useMerchantMenu } from "@/features/merchants/api";
import { cn } from "@/lib/utils/cn";

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const MERCHANT_TABS: TabDef[] = [
  { id: "profile", label: "Profile", icon: UserCog },
  { id: "brand", label: "Brand", icon: Palette },
  { id: "menu", label: "Menu", icon: Utensils },
  { id: "keywords", label: "Keywords", icon: Search },
  { id: "competitors", label: "Competitors", icon: Swords },
  { id: "catering", label: "Catering", icon: UtensilsCrossed },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "services", label: "Services", icon: Layers },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "promotions", label: "Promotions", icon: Tag },
  { id: "connections", label: "Access", icon: Plug },
  { id: "history", label: "History", icon: History },
];

/**
 * Sub-navigation for the Profiling module, one level below the workspace's
 * module row (`MerchantModuleTabs`). Deliberately a different visual
 * language — a compact segmented control next to a section heading, not
 * another full-width bar — so the two levels read as a hierarchy (page nav →
 * section view-switcher) rather than duplicate stacked tab bars.
 */
export function MerchantTabs({ merchantId }: { merchantId: string }) {
  const pathname = usePathname();
  // A menu loading in the background shows as a spinner on the Menu tab.
  const { data: menu } = useMerchantMenu(merchantId);
  const menuLoading = menu?.lastStatus === "RUNNING";

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-foreground">Profiling</h2>
      <div
        className="flex gap-0.5 overflow-x-auto rounded-lg bg-muted p-1"
        role="tablist"
        aria-label="Profiling sections"
      >
        {MERCHANT_TABS.map((tab) => {
          const href = `/merchants/${merchantId}/${tab.id}`;
          const active = pathname === href || pathname.startsWith(href + "/");
          const Icon = tab.id === "menu" && menuLoading ? LoaderCircle : tab.icon;
          return (
            <Link
              key={tab.id}
              href={href}
              scroll={false}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-table font-medium transition-colors",
                active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4", tab.id === "menu" && menuLoading && "animate-spin text-primary")} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
