"use client";

import Link from "next/link";
import { BookOpen, KeyRound } from "lucide-react";
import { Card, CardBody, EmptyState, Skeleton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCan } from "@/features/auth/use-can";
import { useLibraryTree } from "../api";
import { SECTION_LABEL } from "../types";

/** /ops/library — recently updated pages and a way into the vault. */
export function LibraryHome() {
  const { data, isPending } = useLibraryTree();
  const can = useCan();
  const recent = [...(data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardBody className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recently updated</h2>
          {isPending ? (
            <Skeleton className="h-4 w-1/2" />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="The Library is empty"
              description="Start with your brand guidelines, the ticket routing rules, or a merchant's brand notes. Use New page."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link href={`/ops/library/${p.id}`} className="flex items-center gap-3 py-2 text-sm hover:bg-muted/50">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {p.merchant ? `${p.merchant.name} · ` : ""}
                      {p.title}
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">{SECTION_LABEL[p.section]}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(p.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      {can("credentials.view") && (
      <Link href="/ops/library/credentials">
        <Card className="transition-colors hover:bg-muted/40">
          <CardBody className="flex items-center gap-3">
            <KeyRound className="size-5 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-foreground">Credentials vault</p>
              <p className="text-xs text-muted-foreground">Merchant and Innowi logins — encrypted, and every reveal is logged.</p>
            </div>
          </CardBody>
        </Card>
      </Link>
      )}
    </div>
  );
}
