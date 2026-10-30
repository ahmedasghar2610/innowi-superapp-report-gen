import { Mail } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function EmailSmsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Email & SMS</h1>
      <p className="mt-1 text-table text-muted-foreground">Campaign builder and send history across your merchants.</p>
      <div className="mt-5">
        <ComingSoon
          title="Email & SMS — currently being worked on"
          description="This section is currently being worked on. Check back soon."
          icon={Mail}
        />
      </div>
    </div>
  );
}
