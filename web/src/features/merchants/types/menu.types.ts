/**
 * Merchant → Profiling → Menu. Mirrors app/schemas/menu.py.
 * The menu is extracted from the merchant's Innowi Online Ordering page.
 */

/** VALID items are shown by default; the rest were filtered out and why. */
export type MenuItemStatus = "VALID" | "NO_IMAGE" | "LOGO_GRAPHIC" | "REPEATED_GRAPHIC";

export interface MenuItem {
  id: string;
  name: string;
  price: number | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
  status: MenuItemStatus | string;
}

export interface MenuStats {
  total: number;
  valid: number;
  graphicSkipped: number;
  noImage: number;
}

/** Live progress of a running extraction. */
export interface MenuProgress {
  phase: "connecting" | "menu" | "images" | "saving" | "done" | string;
  /** Photos checked so far / to check (phase "images"). */
  done: number;
  total: number;
}

export interface MenuSummary {
  merchantId: string;
  /** True once a menu has been extracted successfully at least once. */
  exists: boolean;
  /** The merchant's saved "Online ordering" value, and whether it is an Innowi ordering link. */
  merchantOnlineOrdering: string | null;
  merchantLinkUsable: boolean;
  /** The Innowi link the menu is fetched from: the one in the Online ordering text, or the one picked. */
  merchantLink?: string | null;
  /** Every Innowi link found in the Online ordering text (several = pick one). */
  merchantLinks?: string[];
  sourceUrl: string | null;
  subUrl: string | null;
  branchId: number | null;
  restaurantName: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  excludeCatering: boolean;
  filterGraphics: boolean;
  stats: MenuStats;
  /** RUNNING while an extraction is in progress (it runs in the background). */
  lastStatus: "OK" | "FAILED" | "RUNNING" | null;
  progress: MenuProgress | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  extractedAt: string | null;
  extractedBy: string | null;
}

export interface MerchantMenu extends MenuSummary {
  categories: string[];
  items: MenuItem[];
}

export interface ExtractMenuInput {
  /** Ordering link or branch slug; omitted → the merchant's saved link. */
  link?: string;
  excludeCatering?: boolean;
  filterGraphics?: boolean;
  /** Save the link as the merchant's "Online ordering" (default true). */
  saveLink?: boolean;
}
