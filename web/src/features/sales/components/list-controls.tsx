"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui";

/** Value that only updates after `ms` without changes — keeps typing from firing a request per key. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Page number that belongs to one "whose records" choice: when a manager picks
 * someone else in "Showing", the list starts again at page 1 instead of asking
 * for, say, page 4 of a person who has one page.
 */
export function usePageFor(scopeKey: string): [number, (page: number) => void] {
  const [state, setState] = useState({ key: scopeKey, page: 1 });
  const setPage = useCallback((page: number) => setState({ key: scopeKey, page }), [scopeKey]);
  return [state.key === scopeKey ? state.page : 1, setPage];
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={100}
        className="pl-8"
      />
    </div>
  );
}

export function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className={className ?? "w-44"}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>;
}
