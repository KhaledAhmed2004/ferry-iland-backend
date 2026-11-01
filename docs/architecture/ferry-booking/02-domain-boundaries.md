# Architecture Step 2: Domain Model & Architecture Boundaries
**Feature:** Ferry Booking Platform  
**Source Specification:** [docs/specs/ferry-booking-ui-spec.md](file:///c:/Users/Khaled/Khaled%20Dask/Backend/nestJs/docs/specs/ferry-booking-ui-spec.md)  
**Parent Discovery:** [01-domain-discovery.md](file:///c:/Users/Khaled/Khaled%20Dask/Backend/nestJs/docs/architecture/ferry-booking/01-domain-discovery.md)  
**Status:** Approved & Model-Locked  
**Date:** 2026-10-13  

---

## 1. Domain Boundary Philosophy (DDD Standard)
Rather than treating every concept as a heavy relational PostgreSQL table, the domain model is organized according to Domain-Driven Design (DDD) principles:
* **Aggregate Roots** preserve transactional consistency boundaries.
* **Entities** possess unique relational identities and lifecycles.
* **Value Objects** represent immutable descriptive attributes without independent identity.
* **Ephemeral States** represent transient, high-velocity concurrency locks stored in fast cache (Redis TTL), avoiding database lock contention.

---

## 2. Aggregate Roots, Entities & Value Objects Classification

```mermaid
classDiagram
    class Provider {
        <<Aggregate Root>>
        +UUID id
        +String name
        +ProviderStatus status
        +Decimal customCommissionRate
        +ContactInfo contact
    }

    class Vessel {
        <<Entity>>
        +UUID id
        +String name
        +VesselType type
        +Int passengerCapacity
        +VesselStatus status
    }

    class Route {
        <<Entity>>
        +UUID id
        +Port originPort
        +Port destinationPort
        +Int durationMinutes
        +Money baseFare
    }

    class Trip {
        <<Aggregate Root>>
        +UUID id
        +DateTime departureTime
        +Int totalSeats
        +Int availableSeats
        +TripStatus status
        +reserveSeats(count)
        +releaseSeats(count)
    }

    class Booking {
        <<Aggregate Root>>
        +UUID id
        +String bookingReference
        +BookingStatus status
        +Money totalFare
        +ContactInfo booker
        +List~PassengerInfo~ passengers
    }

    class PassengerInfo {
        <<Value Object>>
        +String fullName
        +String idOrPassport
        +PassengerType type
    }

    class ContactInfo {
        <<Value Object>>
        +String email
        +String phone
        +String contactPerson
    }

    class Money {
        <<Value Object>>
        +Decimal amount
        +String currency
    }

    class SeatHold {
        <<Ephemeral State - Redis>>
        +String holdToken
        +UUID tripId
        +Int seatCount
        +DateTime expiresAt
    }

    Provider "1" *-- "*" Vessel : owns
    Provider "1" *-- "*" Trip : operates
    Route "1" <-- "*" Trip : scheduled on
    Trip ..> SeatHold : locks temporary inventory
    SeatHold ..> Booking : converts on payment
    Booking *-- "1..*" PassengerInfo : embeds
    Booking *-- "1" ContactInfo : embeds
    Booking *-- "1" Money : embeds
```

### 1. Aggregate Roots
* **`Trip` (Aggregate Root):**
  - **Boundary:** Enforces seat availability invariants. All seat holds and decrements pass through the `Trip` aggregate to prevent overbooking.
  - **Key Attributes:** `id`, `providerId`, `vesselId`, `routeId`, `departureTime`, `availableSeats`, `status`.
* **`Booking` (Aggregate Root):**
  - **Boundary:** Manages the lifecycle of a passenger's confirmed reservation, ticketing, and line-item passenger details.
  - **Key Attributes:** `id`, `bookingReference`, `outboundTripId`, `inboundTripId?`, `status`, `totalAmount`, `bookerContact`.
* **`Provider` (Aggregate Root):**
  - **Boundary:** Owns commercial fleet data, assigned vessels, and contractual take-rate overrides.

### 2. Entities (Sub-Domain Objects with Identity)
* **`Port`:** Geographic transit terminal (`id`, `name`, `code`, `island`, `atoll`, `coordinates`, `isActive`).
* **`Route`:** Directed connection between two ports (`id`, `originPortId`, `destinationPortId`, `durationMinutes`, `category`).
* **`Vessel`:** Marine craft owned by a provider (`id`, `providerId`, `name`, `type`, `capacity`, `yearBuilt`, `status`).

### 3. Value Objects (Immutable Data Contracts)
* **`PassengerInfo`:** Name, ID/Passport, Passenger Type (`ADULT`, `CHILD`, `INFANT`). Belongs exclusively to a `Booking`; has no lifecycle without its parent booking.
* **`ContactInfo`:** Email, Phone, Primary Booker Name.
* **`Money`:** Amount and currency (`USD`), providing immutable precision.

### 4. Ephemeral / Concurrency State
* **`SeatHold` (Redis Cache with TTL):**
  - **Key Format:** `ferry:hold:{tripId}:{holdToken}`
  - **Payload:** `{ tripId, seatCount, expiresAt: timestamp }`
  - **TTL:** 600 seconds (10 minutes).
  - *Why not a Postgres table?* Storing rapid user checkouts in Redis prevents write-amplification, row-level locks, and table bloat on high-traffic booking days.

---

## 3. Bounded Contexts & Modular NestJS Scopes

The backend is partitioned into 5 clean, decoupled NestJS modules:

| Bounded Context | NestJS Module | Responsibilities | Access Scope |
|---|---|---|---|
| **Identity & Access** | `AuthModule` | JWT auth, role validation, password hashing, session tokens. | Public & Authenticated |
| **Catalog & Geography** | `CatalogModule` | Ports, Routes, Popular Journeys, dynamic category tabs. | Public Storefront |
| **Operations & Fleet** | `OperationsModule` | Providers, Vessels, Schedules, Trips, Manifests, Boarding check-in. | Operator (Tenant Scoped) |
| **Sales & Booking Engine** | `BookingModule` | Seat hold management (Redis), Checkout, Ticket lookup, Cancellation. | Public & Passengers |
| **Platform Governance** | `AdminModule` | Provider suspension, Commission take-rate setup, Payment ledger. | Super Admin Only |

---

## 4. Cross-Module Data Flow & Tenant Isolation Matrix

```mermaid
sequenceDiagram
    autonumber
    actor Customer as Passenger (Storefront)
    participant Catalog as CatalogModule
    participant Booking as BookingModule
    participant Redis as Redis Cache (SeatHold)
    participant Ops as OperationsModule (Trip Aggregate)

    Customer->>Catalog: Search Trips (origin, destination, date, pax)
    Catalog->>Ops: Query active scheduled trips with availableSeats >= pax
    Ops-->>Customer: Return Available Trips Grid

    Customer->>Booking: Request Seat Hold (tripId, seatCount)
    Booking->>Ops: Check capacity invariant
    Booking->>Redis: SETEX ferry:hold:{tripId}:{holdToken} 600 {pax}
    Ops->>Ops: Atomic decrement availableSeats
    Booking-->>Customer: Hold Token & 10-min Countdown

    Customer->>Booking: Checkout (holdToken, passenger details, payment)
    Booking->>Redis: Verify & consume hold token
    Booking->>Booking: Create Booking Aggregate (CONFIRMED)
    Booking-->>Customer: Issue Digital Ticket (FG-XXXXXXXX)
```

---

## 5. Security & Isolation Boundaries
1. **Tenant Data Isolation Rule:**
   All queries inside `OperationsModule` must strictly include:
   ```typescript
   where: { providerId: user.providerId }
   ```
   Operators can never query or mutate vessels, schedules, or manifests outside their own organization.
2. **Super Admin Oversight:**
   `AdminModule` possesses read/write access across all providers but operates under strict audit logging for sensitive actions like `SUSPEND_PROVIDER` or `UPDATE_COMMISSION_POLICY`.
