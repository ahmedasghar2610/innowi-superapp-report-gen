"use client";

// The Site Builder visual editor (components/editor, copied from the Super App
// by scripts/sync-editor.cjs), pointed at this site's API routes. The preview
// iframe shows /<slug>/admin/preview, which renders the stored page — or, before
// the first save, the template page as editable HTML.
import VisualEditor from "@/components/editor/VisualEditor";
import { ToastProvider } from "@/components/ui/toast";

export default function AdminEditorClient({ slug, siteName }: { slug: string; siteName?: string }) {
  const s = encodeURIComponent(slug);
  return (
    <ToastProvider>
      <VisualEditor
        apiBase={`/api/sites/${s}/admin`}
        previewBase={`/${s}/admin/preview?path=`}
        siteName={siteName}
        exitHref={`/${s}`}
        exitLabel="View site"
      />
    </ToastProvider>
  );
}
