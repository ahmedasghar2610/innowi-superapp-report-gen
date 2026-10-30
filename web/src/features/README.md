# Features (feature-based architecture)

Each domain feature is a **self-contained vertical slice** under `src/features/`.
Nothing merchant-specific is built yet (Phase 0 delivers only the foundation),
but every feature added later follows this shape:

```
src/features/<feature>/
├─ api/            # resource functions over @/lib/api/http + TanStack Query hooks
│  ├─ <feature>.api.ts     # getX, createX, updateX, deleteX (typed)
│  └─ <feature>.queries.ts # useX / useXList / useCreateX … (query keys from @/lib/query)
├─ components/     # feature UI (tables, forms, drawers) built from @/components/ui
├─ types/          # feature DTO/view types (later: re-exported from generated OpenAPI types)
└─ index.ts        # public surface of the feature
```

Rules of thumb:

- **Routing lives in `app/`, logic lives in `features/`.** A route file
  (`app/(app)/merchants/page.tsx`) stays thin and composes a feature component.
- **Reusable, cross-cutting UI stays in `@/components/ui`.** If two features
  would import it, it belongs there, not inside a feature.
- **Data access goes through `@/lib/api/http`**, never `axios` directly, so the
  envelope + error handling stay centralized.
- **Query keys come from `@/lib/query/query-keys.ts`** so invalidation is
  consistent across features.

Planned first feature: `features/merchants/` — see
`Merchant_Profiling_Implementation_Plan.md` §5–6.
