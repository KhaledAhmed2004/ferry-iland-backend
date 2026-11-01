# Ferry Booking Backend Modules — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the complete backend core for the Ferry Booking platform, covering Port management, Operator Vessels (Ferries), Trip Schedules, Public Ferry Search, Customer Bookings, Coast Guard Manifest/Tickets, Off-days, and Payments.

**Architecture:** Express.js + TypeScript layered architecture (Route -> Controller -> Service -> Prisma). Clean self-documenting code without redundant comments, strict Zod validations, tenant-isolated operator operations, and modular REST design.

**Tech Stack:** Node.js, Express, TypeScript, Prisma (PostgreSQL), Zod, Vitest.

---

## Phased Overview

| Phase | Module | Purpose | Depends On | Status |
|:---:|:---|:---|:---|:---:|
| **Phase 1** | **Database Schema (Prisma)** | Add `Ferry`, `Schedule`, `Booking`, `Ticket`, `Payment`, `OffDay` models | Current Schema | ✅ Completed |
| **Phase 2** | **Port Module** | Admin CRUD & public list of island ports | Phase 1 | ✅ Completed |
| **Phase 3** | **Ferry (Vessel) Module** | Operator fleet management (CRUD, seat capacity, maintenance status) | Phase 1 | ✅ Completed |
| **Phase 4** | **Schedule & Ferry Search Module** | Timetables, 30m turnaround validation, live trip status, and public customer search | Phase 2, 3 | ✅ Completed |
| **Phase 5** | **Booking Module** | Multi-passenger checkout, seat clamping, `FRY-YYYYMMDD-XXXX` reference, self-service lookup | Phase 4 | ✅ Completed |
| **Phase 6** | **Ticket & Manifest Module** | Digital pass, Coast Guard passenger roll-call, ramp boarding confirmation | Phase 5 | ✅ Completed |
| **Phase 7** | **Off-Day Module** | Calendar blackouts for maintenance, stormy weather, or holidays | Phase 3 | ✅ Completed |
| **Phase 8** | **Provider Management Module** | Admin provider listings, audit details, suspension cascading logic, operator settings | Phase 1, 3 | ✅ Completed |
| **Phase 9** | **Dashboard & Ferry Analytics** | Operator Command Center overview & Super Admin platform KPIs | Phase 5, 6, 8 | ✅ Completed |
| **Phase 10** | **Payment & Revenue Module** | Payment intents, platform commission & payouts (On hold pending client gateway selection) | Phase 5 | ⏸️ On Hold |
| **Phase 11** | **Route Integration & Regression Tests** | All routes mounted in `src/routes/index.ts`, 227 tests passing across 18 test suites | All | ✅ Completed |

---

### Task 1: Prisma Schema Expansion

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Update Schema with new Enums and Models**
Add the following models and relations to `prisma/schema.prisma`:
- `enum VesselType { CATAMARAN, SPEEDBOAT, TRADITIONAL_FERRY }`
- `enum VesselStatus { IN_SERVICE, MAINTENANCE, OUT_OF_SERVICE }`
- `enum TripStatus { ON_TIME, PREPARING, BOARDING, DEPARTED, DELAYED, CANCELLED }`
- `enum BookingStatus { PENDING, CONFIRMED, CANCELLED, CHECKED_IN }`
- `enum BoardingStatus { PENDING, CHECKED_IN, BOARDED }`
- `enum CabinClass { STANDARD, BUSINESS, VIP }`
- `enum OffDayCategory { MAINTENANCE, WEATHER, PUBLIC_HOLIDAY }`
- `enum PaymentStatus { PENDING, COMPLETED, REFUNDED, FAILED }`
- Models: `Ferry`, `Schedule`, `Booking`, `Ticket`, `Payment`, `OffDay`
- Link `Ferry` and `Route` to `OperatorProfile`
- Link `Schedule` to `Route` and `Ferry`

**Step 2: Generate Prisma Client & Run Verification**
```powershell
npx prisma generate
```
Expected: Prisma client generated successfully without schema validation errors.

**Step 3: Commit**
```bash
git add prisma/schema.prisma
git commit -m "feat(db): expand prisma schema with ferry, schedule, booking, ticket, payment, and offday models"
```

---

### Task 2: Port Module (`src/app/modules/port`)

**Files:**
- Create: `src/app/modules/port/port.interface.ts`
- Create: `src/app/modules/port/port.validation.ts`
- Create: `src/app/modules/port/port.service.ts`
- Create: `src/app/modules/port/port.controller.ts`
- Create: `src/app/modules/port/port.route.ts`
- Test: `src/app/modules/port/__tests__/port.spec.ts`

**Endpoints:**
- `GET /api/v1/ports` — Public list of active ports
- `POST /api/v1/ports` — Admin create port
- `GET /api/v1/ports/:id` — Get single port
- `PATCH /api/v1/ports/:id` — Admin update port
- `DELETE /api/v1/ports/:id` — Admin deactivate port

**Step 1: Write Unit & Integration Tests**
Write tests covering:
- Public list returns active ports only
- Non-admin cannot create/update ports (403)
- Admin can create port with valid payload (name, code, atoll)
- Duplicate port code throws 400 Bad Request

**Step 2: Implement Port Zod Schemas, Service, Controller, and Routes**
Follow standard clean-code architecture with self-documenting naming and no comments.

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/port/__tests__/port.spec.ts
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/port
git commit -m "feat(port): implement island port management module with admin crud and public list"
```

---

### Task 3: Ferry (Vessel) Module (`src/app/modules/ferry`)

**Files:**
- Create: `src/app/modules/ferry/ferry.interface.ts`
- Create: `src/app/modules/ferry/ferry.validation.ts`
- Create: `src/app/modules/ferry/ferry.service.ts`
- Create: `src/app/modules/ferry/ferry.controller.ts`
- Create: `src/app/modules/ferry/ferry.route.ts`
- Test: `src/app/modules/ferry/__tests__/ferry.spec.ts`

**Endpoints:**
- `GET /api/v1/operator/ferries` — List operator's vessels (`Role.OPERATOR`)
- `POST /api/v1/operator/ferries` — Register new vessel
- `GET /api/v1/operator/ferries/:id` — Get vessel details
- `PATCH /api/v1/operator/ferries/:id` — Update vessel / toggle maintenance
- `DELETE /api/v1/operator/ferries/:id` — Decommission vessel

**Step 1: Write Unit Tests**
Verify:
- Tenant isolation: Operator A cannot view or edit Operator B's vessels.
- Unique registration code enforcement.
- Capacity must be a positive integer >= 10.

**Step 2: Implement Ferry Module Code**
Write self-documenting code without redundant comments.

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/ferry/__tests__/ferry.spec.ts
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/ferry
git commit -m "feat(ferry): implement operator fleet management module with tenant isolation"
```

---

### Task 4: Schedule & Ferry Search Module (`src/app/modules/schedule`)

**Files:**
- Create: `src/app/modules/schedule/schedule.interface.ts`
- Create: `src/app/modules/schedule/schedule.validation.ts`
- Create: `src/app/modules/schedule/schedule.service.ts`
- Create: `src/app/modules/schedule/schedule.controller.ts`
- Create: `src/app/modules/schedule/schedule.route.ts`
- Test: `src/app/modules/schedule/__tests__/schedule.spec.ts`
- Test: `src/app/modules/schedule/__tests__/ferrySearch.spec.ts`

**Endpoints:**
- `GET /api/v1/trips/search` — Public Ferry Search (One-way and Round-trip, seat availability check, pricing breakdown)
- `GET /api/v1/operator/schedules` — List operator departure slots
- `POST /api/v1/operator/schedules` — Create daily schedule slot
- `PATCH /api/v1/operator/schedules/:id` — Update gate / timings
- `PATCH /api/v1/operator/schedules/:id/status` — Live status transition (`BOARDING`, `DEPARTED`, `DELAYED`, `CANCELLED`)

**Step 1: Write Search & Turnaround Buffer Tests**
- Verify 30-minute turnaround validation between consecutive trips of the same vessel.
- Verify public search checks passenger counts against available capacity.
- Verify round-trip search returns both `outboundTrips` and `returnTrips`.

**Step 2: Implement Schedule Service and Public Search Engine**
Implement strict validation logic and date calculations.

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/schedule/__tests__/
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/schedule
git commit -m "feat(schedule): implement departure timetable and public ferry search engine"
```

---

### Task 5: Booking & Reservation Module (`src/app/modules/booking`)

**Files:**
- Create: `src/app/modules/booking/booking.interface.ts`
- Create: `src/app/modules/booking/booking.validation.ts`
- Create: `src/app/modules/booking/booking.service.ts`
- Create: `src/app/modules/booking/booking.controller.ts`
- Create: `src/app/modules/booking/booking.route.ts`
- Test: `src/app/modules/booking/__tests__/booking.spec.ts`

**Endpoints:**
- `POST /api/v1/bookings` — Create reservation (atomic seat decrement, reference generator `FRY-YYYYMMDD-XXXX`)
- `GET /api/v1/bookings/my` — Customer bookings list
- `GET /api/v1/manage-booking/:reference` — Public self-service lookup by reference
- `PATCH /api/v1/bookings/:id/cancel` — Cancel reservation
- `GET /api/v1/operator/bookings` — Operator booking manifest query
- `PATCH /api/v1/operator/bookings/:id/check-in` — Operator inline check-in
- `GET /api/v1/admin/bookings` — Platform master booking audit

**Step 1: Write Booking Tests**
- Concurrent booking seat clamping (overbooking prevention).
- Reference code format validation.
- Unauthorized access prevention on customer tickets.

**Step 2: Implement Booking Module**
Use Prisma interactive transactions (`$transaction`) for seat decrements and booking record generation.

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/booking/__tests__/booking.spec.ts
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/booking
git commit -m "feat(booking): implement reservation engine, seat clamping, and self-service portal lookup"
```

---

### Task 6: Ticket & Coast Guard Manifest Module (`src/app/modules/ticket`)

**Files:**
- Create: `src/app/modules/ticket/ticket.interface.ts`
- Create: `src/app/modules/ticket/ticket.validation.ts`
- Create: `src/app/modules/ticket/ticket.service.ts`
- Create: `src/app/modules/ticket/ticket.controller.ts`
- Create: `src/app/modules/ticket/ticket.route.ts`
- Test: `src/app/modules/ticket/__tests__/ticket.spec.ts`

**Endpoints:**
- `GET /api/v1/tickets/:reference` — Download/View digital boarding pass
- `GET /api/v1/operator/manifest` — Coast Guard passenger roll call for a specific trip
- `PATCH /api/v1/operator/manifest/:ticketId/board` — Mark passenger boarded onto vessel ramp
- `PATCH /api/v1/operator/manifest/:ticketId/unboard` — Revert boarding status if passenger steps down

**Step 1: Write Manifest & Boarding Tests**
- Roll call reflects all passenger names, passport numbers, and nationality.
- Immutability check: Cannot change manifest once trip is `DEPARTED`.

**Step 2: Implement Ticket & Manifest Module**

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/ticket/__tests__/ticket.spec.ts
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/ticket
git commit -m "feat(ticket): implement digital pass generation and coast guard passenger roll-call manifest"
```

---

### Task 7: Off-Day & Fleet Maintenance Module (`src/app/modules/offDay`)

**Files:**
- Create: `src/app/modules/offDay/offDay.interface.ts`
- Create: `src/app/modules/offDay/offDay.validation.ts`
- Create: `src/app/modules/offDay/offDay.service.ts`
- Create: `src/app/modules/offDay/offDay.controller.ts`
- Create: `src/app/modules/offDay/offDay.route.ts`
- Test: `src/app/modules/offDay/__tests__/offDay.spec.ts`

**Endpoints:**
- `GET /api/v1/operator/off-days` — List blackout dates
- `POST /api/v1/operator/off-days` — Block off a date for dry-dock maintenance or holiday
- `DELETE /api/v1/operator/off-days/:id` — Unblock date

**Step 1: Write Tests & Implement OffDay Module**
Ensure scheduling engine prevents creating trips on blocked off-days.

**Step 2: Run Tests**
```powershell
npm run test -- src/app/modules/offDay/__tests__/offDay.spec.ts
```
Expected: PASS

**Step 3: Commit**
```bash
git add src/app/modules/offDay
git commit -m "feat(off-day): implement maintenance blackouts and holiday off-days scheduler"
```

---

### Task 8: Payment & Platform Commission Module (`src/app/modules/payment`)

**Files:**
- Create: `src/app/modules/payment/payment.interface.ts`
- Create: `src/app/modules/payment/payment.validation.ts`
- Create: `src/app/modules/payment/payment.service.ts`
- Create: `src/app/modules/payment/payment.controller.ts`
- Create: `src/app/modules/payment/payment.route.ts`
- Test: `src/app/modules/payment/__tests__/payment.spec.ts`

**Endpoints:**
- `POST /api/v1/payments/intent` — Generate payment intent
- `POST /api/v1/payments/webhook` — Stripe webhook listener to confirm booking
- `GET /api/v1/admin/payments` — Platform revenue audit (Gross, 10% commission, 90% payout)
- `PATCH /api/v1/admin/settings/commission` — Platform take-rate policy update

**Step 1: Write Commission Split Tests**
Verify `$100.00` payment allocates `$10.00` to platform and `$90.00` to operator.

**Step 2: Implement Payment Service & Webhook Handler**

**Step 3: Run Tests**
```powershell
npm run test -- src/app/modules/payment/__tests__/payment.spec.ts
```
Expected: PASS

**Step 4: Commit**
```bash
git add src/app/modules/payment
git commit -m "feat(payment): implement payment intent flow, commission split, and payout tracking"
```

---

### Task 9: System Integration & Regression Testing

**Files:**
- Modify: `src/routes/index.ts` (Register all new routes)
- Test: Full Vitest test suite

**Step 1: Wire all routes into `src/routes/index.ts`**
```typescript
import { PortRoutes } from '../app/modules/port/port.route';
import { FerryRoutes } from '../app/modules/ferry/ferry.route';
import { ScheduleRoutes } from '../app/modules/schedule/schedule.route';
import { BookingRoutes } from '../app/modules/booking/booking.route';
import { TicketRoutes } from '../app/modules/ticket/ticket.route';
import { OffDayRoutes } from '../app/modules/offDay/offDay.route';
import { PaymentRoutes } from '../app/modules/payment/payment.route';
```

**Step 2: Run Entire Test Suite**
```powershell
npm run test
```
Expected: All tests pass with zero regressions.

**Step 3: Commit**
```bash
git add src/routes/index.ts
git commit -m "feat: wire all ferry booking modules into main router with full test verification"
```
