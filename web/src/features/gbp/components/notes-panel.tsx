"use client";

import { useState } from "react";
import { Button, Card, Textarea, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useGbpNotes, useNoteMutations } from "../api";
import { Section } from "./parts";

/** Internal reporting notes ("profile suspended 3 days", "menu link changed")
 *  that explain a dip. Shared with the whole team, signed with the author's
 *  name; never sent to Google. */
export function NotesPanel({ locationId }: { locationId: string }) {
  const notes = useGbpNotes(locationId);
  const { add, edit, remove } = useNoteMutations(locationId);
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const fail = (e: { message: string; messages?: string[] }) => toast({ variant: "error", title: "Couldn't save the note", description: e.messages?.[0] ?? e.message });

  return (
    <Section title="Reporting notes" aside={<span className="text-xs text-muted-foreground">Internal · visible to the team, never posted to Google</span>}>
      <Card className="flex flex-col gap-4 p-4">
        <form
          className="flex flex-col gap-2 print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText(""), onError: fail });
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="What explains the numbers? e.g. “Closed 2 days for maintenance”, “Menu link changed on the 12th”"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!text.trim()} loading={add.isPending}>
              Add note
            </Button>
          </div>
        </form>
        {notes.data?.length === 0 && <p className="text-sm text-muted-foreground">No notes for this listing yet.</p>}
        <ul className="flex flex-col divide-y divide-border">
          {notes.data?.map((n) => (
            <li key={n.id} className="py-2.5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.author?.name ?? "Former user"}</span>
                <span>{formatDateTime(n.createdAt)}</span>
                {n.edited && <span>(edited)</span>}
                {n.canEdit && editing?.id !== n.id && (
                  <span className="ml-auto flex gap-2 print:hidden">
                    <button type="button" className="hover:text-foreground" onClick={() => setEditing({ id: n.id, body: n.body })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="hover:text-text-destructive"
                      onClick={() => remove.mutate(n.id, { onError: fail })}
                    >
                      Delete
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === n.id ? (
                <div className="mt-1.5 flex flex-col gap-2">
                  <Textarea value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} rows={2} maxLength={4000} />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      loading={edit.isPending}
                      disabled={!editing.body.trim()}
                      onClick={() => edit.mutate({ noteId: n.id, body: editing.body.trim() }, { onSuccess: () => setEditing(null), onError: fail })}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}
