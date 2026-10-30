// Shared UI foundation — barrel export. Import from "@/components/ui".

// Primitives
export { Button, type ButtonProps } from "./button";
export { Card, CardHeader, CardTitle, CardBody } from "./card";
export { Badge, BadgeLink, badgeClassName, type BadgeTone, type BadgeProps, type BadgeLinkProps } from "./badge";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Select } from "./select";
export { Field } from "./field";

// Overlays
export { Dialog, type DialogProps } from "./dialog";
export { Drawer, type DrawerProps } from "./drawer";

// Data display
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableMessageRow,
  type SortDirection,
} from "./table";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

// Feedback & state
export { ToastProvider, useToast, type ToastVariant, type ToastOptions } from "./toast";
export { Skeleton } from "./skeleton";
export { Spinner } from "./spinner";
export { EmptyState } from "./empty-state";
export { ComingSoon } from "./coming-soon";
export { ErrorState } from "./error-state";
export { SectionHead } from "./section-head";
export { StatTile, type StatTileProps, type StatTone } from "./stat-tile";
