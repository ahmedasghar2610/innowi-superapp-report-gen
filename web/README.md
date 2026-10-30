# Innowi — Merchant Profiling (Web)

Frontend for the Innowi **Merchant Profiling** module. **Phase 0 foundation** —
app shell, providers, data layer and shared UI. Merchant feature screens are
built in later phases (see `Merchant_Profiling_Implementation_Plan.md`).

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (design tokens ported from the finalized prototype)
- **TanStack Query v5** (server-state) + Devtools
- **Axios** (single instance, `/api/v1`, error normalization, auth seam)
- **Feature-based architecture** (`src/features/*` vertical slices)
- Lucide icons · `clsx` + `tailwind-merge`

## Getting started

```bash
npm install
cp .env.example .env.local      # already present; points at the local API
npm run dev                     # http://localhost:3001
```

This app runs on **3001**; the Innowi Super App API runs on **3000**
(`API_ORIGIN`). The browser never calls the API directly — it calls same-origin
`/api/v1/*`, and `src/app/api/v1/[...path]/route.ts` attaches the bearer token
from the httpOnly cookie and forwards. The foundation renders without the API.

There is **one** backend. Website intake questionnaires were previously served
by a separate FastAPI service on :8000; that service has been merged into the
main API and its endpoints are now `/api/v1/websites`, behind the same auth as
everything else. `NEXT_PUBLIC_WEBSITES_API_BASE_URL` is no longer read.

Scripts: `dev` · `build` · `start` · `lint` · `typecheck`.

## Structure

```
src/
├─ app/
│  ├─ layout.tsx            # root: Inter font, Providers, no-flash theme script
│  ├─ globals.css           # Tailwind v4 + design tokens (:root / .dark → @theme)
│  ├─ not-found.tsx
│  └─ (app)/
│     ├─ layout.tsx         # wraps routes in <AppShell/>
│     └─ page.tsx           # foundation landing
├─ components/
│  ├─ ui/                   # shared UI foundation (Button, Card, Badge, Input, …)
│  └─ layout/               # AppShell, Sidebar, Topbar, Breadcrumbs, ThemeToggle
├─ config/                  # nav.ts (sidebar model), …
├─ features/                # feature slices (merchants/ … — built later)
├─ hooks/
├─ lib/
│  ├─ api/                  # axios.ts, http.ts (envelope helpers), errors.ts
│  ├─ query/                # query-client.ts, query-keys.ts
│  ├─ enums.ts              # enum → label/tone maps (case-sensitive API enums)
│  └─ constants.ts
├─ providers/               # QueryProvider + Providers composer
└─ types/                   # api.ts (envelope + error shapes)
```

## Conventions

- Call the API through `@/lib/api/http` (never `axios` directly) so envelope and
  error handling stay in one place.
- Build payloads from explicit DTO shapes — the backend rejects unknown
  properties with a 400 (`forbidNonWhitelisted`), so never spread a fetched
  object into a `PATCH`.
- Translate enums only through `@/lib/enums.ts`.
- Derive query keys from `@/lib/query/query-keys.ts`.

## Not in this build

Merchant feature screens (list, profile, contacts, locations, services,
documents, connections) — Phase 1+. Also out of scope per the plan: RBAC,
Audit, Profile Completeness, Conflict Resolution, Approval Workflow (no backend
endpoints yet). Seams are left where they will attach.
