# FastAPI port — parity audit vs. the NestJS API

Audited: 2026-09-16. Reference: `innowi-superapp-api` (NestJS 10 + Prisma 5).

## Summary

**No endpoints were missing.** Both APIs publish exactly **80 operations** on
identical paths under `/api/v1`. Authentication and the RBAC capability matrix
were already correct on every route. The defects found were in *how* responses
were shaped and in three places where a write was flushed but never committed.

---

## 1. Endpoint coverage — 80/80, verified

Route lists were extracted from both codebases and diffed. Every Nest
`@Get/@Post/@Patch/@Delete` has a FastAPI counterpart at the same path and
method, including the flat-vs-nested split for child resources
(`POST /merchants/:id/contacts` + `PATCH /contacts/:id`), both upload/download
pairs, and the three 1:1 `GET`-empty / `PATCH`-upsert children.

## 2. Authentication & authorization — correct, verified

Every route's resolved dependency tree was walked and its capability read out
of the `require_capability` closure.

- All 78 protected routes reach `get_current_user`. Only `POST /auth/login` and
  `POST /auth/refresh` are public — matching Nest's two `@Public()` routes.
- Capability per route matches `common/auth/capabilities.ts` exactly:
  `profile.view` / `profile.edit` for staff, `merchant.create` /
  `subscription.write` / `accountManager.*` for managers, `merchant.delete` /
  `users.manage` / `audit.view` for admins. `SUPER_ADMIN` bypasses.
- Field-level gate on `PATCH /merchants/:id` (`accountManagerId` requires
  `accountManager.assign`) is present, as are the self-lockout guards on
  `PATCH/DELETE /users/:id`.

23 runtime assertions covering 401s, the 403 matrix per role, and the uniform
error envelope all pass.

---

## 3. Defects found and fixed

### Critical — writes that never reached the database

`get_db()` yields a session and never commits, so `await session.flush()`
without a matching `commit()` is discarded when the request ends.

| Location | Effect before fix |
|---|---|
| `AuthService.refresh` | The rotated refresh token was **never revoked** — an old token stayed replayable forever, defeating the stolen-token defence the rotation exists for. |
| `AuthService.logout` | Logout was a **no-op**; the token stayed valid. |
| `AuthService._revoke_all_for_user` | `POST /auth/logout-all` was a **no-op**. (Callers that committed afterwards — `change_password`, `update`, `remove` — did work.) |

All three now `commit()`.

### High — login rejected valid credentials

`UserService.create` stores `email.lower()`, and Nest looked up with
`email.toLowerCase()`, but `AuthService.login` compared the raw input. Anyone
typing `Marketing@Innowi.com` could never log in. Now lower-cases on lookup.

### High — unknown request fields were silently ignored

Nest ran a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`,
so a typo'd or unexpected body key is a **400**. Pydantic's default is to drop
extras, so `{"restaurantName": "X", "cusineCategory": "Thai"}` was accepted and
the misspelled field silently lost. Added `model_config = {"extra": "forbid"}`
to all 35 input DTOs.

### Medium — `/profile` and `/fields` were missing `completion`

Nest's `MerchantProfileDto` is `{ merchant, fields, completion }` and
`ProfileFieldsResponseDto` is `{ data, completion }` — deliberately, so the
Profile tab renders the completion score, missing files and pending
connections without a second request. Both were returning only the first
key(s). `completion` is now included, built by a shared `_completeness_dto()`
helper that `GET /merchants/:id/completeness` also uses.

### Medium — 16 endpoints had no declared response schema

Every list and derived-view route returned a bare `dict`, so the OpenAPI
document carried no schema and nothing validated the shape. Added the
envelopes Nest declares, all now wired via `response_model=`:

`ContactsResponseDto`, `LocationsResponseDto`, `KeywordsResponseDto`,
`CompetitorsResponseDto`, `ConnectionsResponseDto`,
`MerchantServicesResponseDto`, `DocumentsResponseDto`,
`BrandAssetsResponseDto`, `PromotionsResponseDto`,
`AccountManagersResponseDto`, `PaginatedMerchantsDto`, `PaginatedUsersDto`,
`MerchantProfileDto`, `ProfileFieldsResponseDto`, `ProfileCompletenessDto`
(+ 7 nested), `ProfileAlertsResponseDto` (+ 1 nested),
`DataQualityResponseDto` (+ 6 nested).

Only the two file-download routes and the 204 deletes remain untyped, which is
correct.

### Medium — brand assets leaked the internal storage key

`BrandAssetResponseDto` returned `url` (the raw storage key) and omitted
`hasFile`. Nest exposes `hasFile` + `downloadPath` and never the key. Matched.

### Medium — upload size limit applied after buffering

`read_upload_within_limit` read the entire body into memory and *then*
compared against `MAX_UPLOAD_MB`, so a large upload allocates before the 413.
Multer enforced the cap mid-stream; it now reads in 1 MB chunks and aborts as
soon as the cap is passed. Also added Nest's missing/empty-file 400.

### Medium — audit failure rows could commit partial writes

On the failure path `@audited` called `db.commit()` on a session that may hold
the handler's partial writes, persisting them alongside the `FAILURE` row. Now
rolls back first. Success rows also record the real status (201/204) instead of
a hardcoded 200.

### Low — the endpoint-coverage test was vacuous

`test_all_76_reference_endpoints_present` walked `app.routes` one level deep.
FastAPI ≥ 0.141 includes sub-routers lazily as `_IncludedRouter` wrappers, so
the walk found 2 routes and the assertion had been passing on nothing. It now
reads the generated OpenAPI document, covers the 4 promotion endpoints the
list had omitted (80 total), and asserts there are no *undocumented* extras.

---

## 4. Verification run

- 80/80 route parity, diffed against the Nest controllers.
- Per-route auth + capability + response-model table, generated from the
  resolved dependency graph.
- 23 runtime assertions: 401 on protected routes, 403 matrix per role,
  public login, `extra="forbid"` 400s, uniform error envelope.
- `ProfileCompletenessDto` / `ProfileAlertsResponseDto` validated against real
  calculator output; `DataQualityResponseDto` against the handler's shape.
- Full suite: **30 passed**.

Not covered: nothing was exercised against a live Postgres. Run the
integration suite against a seeded database before shipping — in particular
login → refresh → logout, to confirm the commit fixes end to end.

## 5. Known differences left in place

- `SubscriptionResponseDto` carries an extra `merchantId` that Nest's
  `MerchantSubscriptionDto` does not. Additive and harmless; left alone.
- `SubscriptionResponseDto.package` / `MerchantSubscriptionDto.package` are
  typed `dict` rather than a `MerchantPackageDto` model. Worth tightening.
- `GET /account-managers` and `GET /profiling/data-quality` issue one count
  query per merchant (N+1). Correct, but worth a `GROUP BY` before the
  portfolio grows.
- `refresh_completion_cache()` commits mid-request. It mirrors the Nest
  write-behind cache, but it means a handler's earlier writes are committed at
  that point rather than at the end.
