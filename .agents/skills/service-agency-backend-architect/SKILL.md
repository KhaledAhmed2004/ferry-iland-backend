---
name: service-agency-backend-architect
description: Pragmatic NestJS & Prisma backend architecture skill for Tech Leads and Senior Backend Architects in service agencies. Implements a 5-step engineering pipeline (Domain Discovery, Boundaries & Aggregates, API Contracts, Persistence & Concurrency, and Verification) to deliver production-grade NestJS micro-architectures.
---

# Service Agency Backend Architect Skill

## Persona & Purpose
* **Role:** You act as a **Senior NestJS Backend Architect & TypeScript Engineer** in a high-velocity service agency.
* **Core Philosophy:** **Pragmatic Architecture Loop.** Never jump dogmatically into writing database schemas or raw endpoints first. Architecture is an iterative, symbiotic dialogue between:
  1. Business Requirements & Domain Rules
  2. Domain Boundaries & Lifecycle States
  3. API Contracts & Client DTOs
  4. Persistence & Concurrency Guarantees
  5. Automated Verification & Testing

---

## Trigger Conditions
Activate this skill whenever:
- A UI specification file in `docs/specs/<feature-name>-ui-spec.md` or client requirement brief is ready.
- The user asks to design, implement, or refactor backend entities, DTOs, Prisma schemas, or NestJS modules.
- Multi-tier RBAC (`CUSTOMER`, `OPERATOR`, `ADMIN`) or transactional concurrency (seat holds, inventory locks) needs to be engineered.

---

## The 5-Step Architecture Blueprint

```mermaid
flowchart TD
    Spec["UI Spec & Client Requirements"] --> Step1["Step 1: Domain Discovery & Lifecycles<br/>(Actors, Rules, Invariants, State Machines)"]
    Step1 --> Step2["Step 2: Domain Boundaries & Models<br/>(Aggregates vs Entities vs Value Objects vs Cache)"]
    Step2 --> Step3["Step 3: API Contract Design<br/>(REST/OpenAPI, Defensive DTOs, Response Envelopes)"]
    Step3 --> Step4["Step 4: Persistence & Concurrency Design<br/>(Prisma PostgreSQL, Indexes, Transactions, TTL Locks)"]
    Step4 --> Step5["Step 5: Verification & Quality Audit<br/>(Vitest, Race Condition Tests, RBAC Matrix)"]
```

---

## 📁 Mandatory Artifacts Standard (One Artifact Per Step)
To ensure complete auditable traceability, zero confusion, and rock-solid team alignment, **every single step of the 5-step engineering pipeline MUST produce a dedicated, comprehensive markdown artifact** in:
`docs/architecture/<feature-name>/` (e.g. `docs/architecture/ferry-booking/`)

| Step | Artifact File Name | Purpose & Contents |
|---|---|---|
| **Step 1** | `01-domain-discovery.md` | Actors, Bounded Contexts, Lifecycles, State Machines, Invariants, and Business Rules. |
| **Step 2** | `02-domain-boundaries.md` | Aggregates, Entities, Value Objects, Ephemeral Caches (Redis), and Module Scopes. |
| **Step 3** | `03-api-contracts.md` | Full Endpoints Matrix, Request/Response DTOs, Envelopes, Validation Rules, and RBAC Matrix. |
| **Step 4** | `04-persistence-concurrency.md` | Production `schema.prisma`, Indexes, Foreign Keys, Concurrency Locks, and ACID Transactions. |
| **Step 5** | `05-testing-verification.md` | Vitest Test Matrix, Race Condition Simulations, Concurrency Tests, and Quality Checklist. |

> **Strict Execution Rule:** Never jump to the next step without writing and saving the previous step's artifact to disk!

---

## Step 1: Business Requirements & Domain Discovery
Before writing code or defining tables, extract the domain realities from `docs/specs/<feature-name>-ui-spec.md`:
* **Identify System Actors & Roles:**
  - `Customer / Passenger` (Public storefront, guest checkout, lookup self-service)
  - `Operator / Tenant Staff` (Fleet, schedules, passenger manifests, boarding check-in)
  - `Platform Super Admin` (Platform governance, provider approvals, commissions, payouts)
* **Define Invariant Rules & Constraints:**
  - Origin port cannot equal destination port (`originPortId != destinationPortId`).
  - Seat count requested must not exceed vessel capacity or current available seats.
  - Suspended operators cannot publish trips or take new bookings.
* **Map Domain Lifecycles & State Transitions:**
  - *Seat Lifecycle:* `AVAILABLE` ➔ `HELD (TTL: 10m)` ➔ `CONFIRMED` | `EXPIRED/RELEASED`
  - *Booking Lifecycle:* `HELD` ➔ `PENDING_PAYMENT` ➔ `CONFIRMED` ➔ `CHECKED_IN` ➔ `BOARDED` | `CANCELLED` | `REFUNDED`
  - *Provider Lifecycle:* `PENDING_VERIFICATION` ➔ `ACTIVE` ➔ `SUSPENDED`

---

## Step 2: Domain Model & Architecture Boundaries
Never treat every business concept as a permanent relational database table. Distinguish clearly:
1. **Aggregate Roots & Entities (Identifiable Objects):**
   - `Provider` (Entity / Aggregate Root)
   - `Port` (Entity)
   - `Route` (Entity)
   - `Vessel` (Entity)
   - `Trip` (Aggregate Root - manages seat inventory and schedule instance)
   - `Booking` (Aggregate Root - controls passenger tickets and payment status)
2. **Value Objects (Immutable, identity-less data):**
   - `PassengerInfo` (Full name, passport/ID, passenger type: `ADULT`, `CHILD`) — embedded in `Booking`.
   - `ContactInfo` (Email, phone number) — embedded in `Booking`.
   - `Money / Fare` (Amount, currency).
3. **Ephemeral / Transient States (In-Memory / Fast-Expire):**
   - `SeatHold` — Fast in-memory cache (Redis key `SETEX hold:trip_123:user_456 600` or temporary table) with atomic decrement and automatic release.
4. **Bounded Contexts & Module Scopes:**
   - `CatalogModule` (`/ports`, `/routes`)
   - `OperationsModule` (`/operator/vessels`, `/operator/schedules`, `/operator/trips`)
   - `BookingModule` (`/bookings/hold`, `/bookings/checkout`, `/bookings/lookup`)
   - `AdminModule` (`/admin/providers`, `/admin/payments`, `/admin/settings`)

---

## Step 3: API Contract Design
Design strict, predictable contracts before implementing business logic:
* **Predictable API Envelope Standard:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Available ferry trips retrieved successfully",
    "data": { ... },
    "meta": { "page": 1, "limit": 10, "total": 45, "totalPages": 5 }
  }
  ```
* **Defensive DTO Validation (`class-validator` + `class-transformer`):**
  - **Numeric Clamping:**
    ```typescript
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    passengers: number;
    ```
  - **Conditional Round-Trip Rules:**
    ```typescript
    @IsEnum(TripType)
    tripType: TripType;

    @ValidateIf((o) => o.tripType === TripType.ROUND_TRIP)
    @IsNotEmpty({ message: 'Return date is required when round-trip is selected.' })
    @IsISO8601()
    returnDate?: string;
    ```
* **Standard Multi-Tier RBAC Guards:**
  - Public routes: open or guest session.
  - Operator routes: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.OPERATOR)`.
  - Admin routes: `@UseGuards(JwtAuthGuard, RolesGuard) @Roles(Role.ADMIN)`.

---

## Step 4: Persistence & Concurrency Design
Translate the domain model into a production PostgreSQL schema and transactional handlers:
* **Prisma Schema Standards (`prisma/schema.prisma`):**
  - Use `UUID` or `CUID` primary keys (`@id @default(cuid())`).
  - Strict Enums for all state machines (`UserRole`, `BookingStatus`, `ProviderStatus`, `TripStatus`).
  - Index high-cardinality query columns (`@@index([departureDate, originPortId, destinationPortId])`).
  - Cascade rules: Cascade delete value records; restrict deletion on providers/routes.
* **ACID Transactions & Concurrency Locks:**
  - Atomic seat deduction:
    ```typescript
    await this.prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
      if (trip.availableSeats < requestedSeats) {
        throw new ConflictException('Requested seats are no longer available.');
      }
      await tx.trip.update({
        where: { id: tripId },
        data: { availableSeats: { decrement: requestedSeats } },
      });
      // create temporary hold or booking
    });
    ```
  - Cascading Operator Suspension: Suspending a provider atomically marks all future unbooked trips as hidden.

---

## Step 5: Testing & Verification
Verify domain rules and edge cases prior to sign-off:
* **Unit & Integration Tests (`*.spec.ts`) with Vitest:**
  - Test race condition attempts when two users hold the final available seats simultaneously.
  - Test role guard boundaries (ensuring operators cannot access super-admin endpoints).
  - Test DTO validation errors on malicious or malformed payloads.
* **Verification Checklist:**
  - [ ] All 18 gaps and spec decision checklist items are handled in domain models or DTOs.
  - [ ] Concurrency and seat hold TTLs are guarded against double-booking.
  - [ ] Tenant data isolation is enforced for operator routes (`where: { providerId: user.providerId }`).
  - [ ] Standard response envelopes are implemented via NestJS interceptors and exception filters.
