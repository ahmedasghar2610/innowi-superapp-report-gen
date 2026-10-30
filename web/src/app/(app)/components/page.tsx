"use client";

import { useState } from "react";
import { Store, Info, Trash2, Search } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Badge,
  Input,
  Textarea,
  Select,
  Field,
  Dialog,
  Drawer,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  useToast,
  Skeleton,
  EmptyState,
  ErrorState,
  type SortDirection,
} from "@/components/ui";

/**
 * Component gallery — a live reference for the shared UI foundation.
 * Not a product screen; it exercises every primitive for QA and handoff.
 */
export default function ComponentsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState("overview");
  const [sort, setSort] = useState<SortDirection>("asc");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.011em] text-foreground">UI Components</h1>
        <p className="mt-1 text-table text-muted-foreground">
          The reusable foundation — built on the brand tokens, Tailwind + TypeScript.
        </p>
      </div>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default">Primary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 /> Delete
          </Button>
          <Button variant="default" loading>
            Saving
          </Button>
          <Button size="sm">Small</Button>
          <Button size="icon" aria-label="Search">
            <Search />
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Pending</Badge>
          <Badge tone="danger">Blocker</Badge>
          <Badge tone="dataq">Data issue</Badge>
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <Field label="Restaurant name" required htmlFor="d-name">
            <Input id="d-name" placeholder="Kabob Fusion" />
          </Field>
          <Field label="Account health" htmlFor="d-health">
            <Select id="d-health" defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option>Green</option>
              <option>Yellow</option>
              <option>Red</option>
            </Select>
          </Field>
          <Field label="Website" htmlFor="d-url" error="Enter a valid URL (https://…).">
            <Input id="d-url" aria-invalid defaultValue="kabobfusion" />
          </Field>
          <Field label="Notes" htmlFor="d-notes" className="sm:col-span-2">
            <Textarea id="d-notes" placeholder="Anything worth recording…" />
          </Field>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="contacts" count={3}>
              Contacts
            </TabsTrigger>
            <TabsTrigger value="access" count={9}>
              Access
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-3 text-table text-foreground">
            Overview panel content.
          </TabsContent>
          <TabsContent value="contacts" className="pt-3 text-table text-foreground">
            Contacts panel content.
          </TabsContent>
          <TabsContent value="access" className="pt-3 text-table text-foreground">
            Access &amp; integrations panel content.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                sortable
                sortDirection={sort}
                onSort={() => setSort((s) => (s === "asc" ? "desc" : "asc"))}
              >
                Merchant
              </TableHead>
              <TableHead>Package</TableHead>
              <TableHead>Health</TableHead>
              <TableHead align="right">MRR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[
              ["Kabob Fusion", "Standard", "success", "—"],
              ["Bella Napoli", "Premium", "success", "—"],
              ["Tacos El Primo", "Standard", "danger", "—"],
            ].map(([name, pkg, tone, mrr]) => (
              <TableRow key={name} interactive>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell>{pkg}</TableCell>
                <TableCell>
                  <Badge tone={tone as "success" | "danger"}>{tone === "success" ? "Green" : "Red"}</Badge>
                </TableCell>
                <TableCell align="right">{mrr}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Overlays & Toast">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <Button variant="outline" onClick={() => toast({ variant: "success", title: "Profile saved", description: "Kabob Fusion updated." })}>
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast({
                variant: "error",
                title: "Couldn't save",
                description: "restaurantName already exists.",
                action: { label: "Retry", onClick: () => {} },
              })
            }
          >
            Error toast
          </Button>
        </div>

        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          icon={<Trash2 />}
          tone="danger"
          title="Delete Kabob Fusion?"
          description="This removes the profile and all its children. This cannot be undone."
          footer={
            <>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => setDialogOpen(false)}>
                Delete profile
              </Button>
            </>
          }
        />

        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title="Edit merchant"
          description="Identity fields"
          footer={
            <>
              <Button variant="outline" onClick={() => setDrawerOpen(false)}>
                Cancel
              </Button>
              <Button variant="default" onClick={() => setDrawerOpen(false)}>
                Save changes
              </Button>
            </>
          }
        >
          <div className="grid gap-4">
            <Field label="Restaurant name" required htmlFor="dr-name">
              <Input id="dr-name" defaultValue="Kabob Fusion" />
            </Field>
            <Field label="Cuisine / Category" htmlFor="dr-cuisine">
              <Input id="dr-cuisine" defaultValue="Mediterranean / Halal" />
            </Field>
          </div>
        </Drawer>
      </Section>

      <Section title="States">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Loading</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </CardBody>
          </Card>
          <Card>
            <EmptyState
              icon={Store}
              title="No merchants yet"
              description="Add your first merchant to get started."
              action={<Button variant="default" size="sm">Add merchant</Button>}
            />
          </Card>
          <Card>
            <ErrorState description="The merchants list could not be loaded." onRetry={() => {}} />
          </Card>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-table font-semibold text-foreground">
        <Info className="size-4 text-muted-foreground" />
        {title}
      </div>
      {children}
    </section>
  );
}
