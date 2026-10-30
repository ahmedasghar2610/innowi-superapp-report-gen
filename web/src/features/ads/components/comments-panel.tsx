"use client";

import { useState } from "react";
import { Button, Card, Textarea, useToast } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useCommentMutations, useComments } from "../api";

/** Analysis / Future Actions — notes about this restaurant's ads, shared with
 *  the whole team and signed with the author's name (the prototype kept them
 *  in one browser only). The automatic n8n analysis sits on the Campaigns and
 *  Weekly report tabs. */
export function CommentsPanel({ accountId }: { accountId: string }) {
  const comments = useComments(accountId);
  const { add, edit, remove } = useCommentMutations(accountId);
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const fail = (e: { message: string; messages?: string[] }) => toast({ variant: "error", title: "Couldn't save the comment", description: e.messages?.[0] ?? e.message });
  const submit = () => {
    if (text.trim()) add.mutate(text.trim(), { onSuccess: () => setText(""), onError: fail });
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <form
        className="flex flex-col gap-2 print:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="ads-comment" className="text-sm font-medium text-foreground">
          Add a comment
        </label>
        <Textarea
          id="ads-comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          maxLength={4000}
          placeholder="What did we change and what's next? e.g. “Raised daily budget to $60 after owner approval; test new hero image next week.”"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Visible to the team · Ctrl+Enter to save</span>
          <Button type="submit" size="sm" disabled={!text.trim()} loading={add.isPending}>
            Save comment
          </Button>
        </div>
      </form>
      <div className="text-sm font-semibold text-foreground">Comment history</div>
      {comments.data?.length === 0 && <p className="text-sm text-muted-foreground">No comments yet. Add the first note about this restaurant.</p>}
      <ul className="flex flex-col divide-y divide-border">
        {comments.data?.map((n) => (
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
                  <button type="button" className="hover:text-text-destructive" onClick={() => remove.mutate(n.id, { onError: fail })}>
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
                    onClick={() => edit.mutate({ commentId: n.id, body: editing.body.trim() }, { onSuccess: () => setEditing(null), onError: fail })}
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
  );
}
