"use client";

// Client wrapper so the server page at /admin/edit (which checks the session
// cookie) can render the editor without itself needing "use client".
import VisualEditor from "@/components/editor/VisualEditor";
import { ToastProvider } from "@/components/ui/toast";

export default function AdminEditorClient({ siteName, initialPath = "/" }: { siteName?: string; initialPath?: string }) {
  // The editor reports saves and errors through useToast(), which needs this
  // provider (in the Super App the app-wide one supplies it).
  return (
    <ToastProvider>
      <VisualEditor
        apiBase="/api/admin"
        initialPath={initialPath}
        siteName={siteName}
        exitHref="/admin"
        exitLabel="Back to pages"
      />
    </ToastProvider>
  );
}
