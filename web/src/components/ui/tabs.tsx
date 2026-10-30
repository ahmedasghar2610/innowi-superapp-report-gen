"use client";

import { createContext, useContext, useId, useRef } from "react";
import { cn } from "@/lib/utils/cn";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const TabsContext = createContext<TabsCtx | null>(null);
function useTabs(component: string) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be used within <Tabs>`);
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}
/** Controlled tabs. Compose with TabsList / TabsTrigger / TabsContent. */
export function Tabs({ value, onValueChange, className, children }: TabsProps) {
  const baseId = useId();
  return (
    <TabsContext.Provider value={{ value, setValue: onValueChange, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: React.ReactNode }) {
  const listRef = useRef<HTMLDivElement>(null);

  // Left/Right arrow key roving between triggers.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
    const i = tabs.findIndex((t) => t === document.activeElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    tabs[next]?.focus();
    tabs[next]?.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      // DS "Tabs" / Underline (node 73:2899): tabs sit 4px apart and each
      // selected tab carries its own 1px underline 4px below its body — there
      // is no full-width rule under the strip. pb-1 leaves room for it.
      className={cn("flex gap-1 overflow-x-auto pb-1", className)}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  className?: string;
  children: React.ReactNode;
  /** Optional count/badge shown after the label. */
  count?: React.ReactNode;
}
export function TabsTrigger({ value, className, children, count }: TabsTriggerProps) {
  const { value: active, setValue, baseId } = useTabs("TabsTrigger");
  const selected = active === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        // DS Tab body: h 25 · px-2.5 (10) · gap-1.5 (6) · radius-md · 14/20
        // weight 500. Selected text is --foreground, unselected
        // --muted-foreground. Was px-3.5/py-2.5/text-table, ~40px tall, and
        // coloured the selected label primary rather than foreground.
        "relative flex h-[25px] items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium transition-colors [&_svg]:size-4",
        "after:absolute after:inset-x-0 after:-bottom-1 after:h-px after:content-['']",
        selected
          ? "text-foreground after:bg-primary"
          : "text-muted-foreground after:bg-transparent hover:text-foreground",
        className,
      )}
    >
      {children}
      {count != null && (
        <span
          className={cn(
            "rounded-full px-1.5 text-xs font-medium",
            selected ? "bg-accent text-primary-hover" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: active, baseId } = useTabs("TabsContent");
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
