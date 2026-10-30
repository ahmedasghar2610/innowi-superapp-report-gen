import { Star } from "lucide-react";
import { ComingSoon } from "@/components/ui";

export default function ReviewsPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">Reviews</h1>
      <p className="mt-1 text-table text-muted-foreground">Ratings, review response and reputation across locations.</p>
      <div className="mt-5">
        <ComingSoon title="Reviews — currently being worked on" icon={Star} />
      </div>
    </div>
  );
}
