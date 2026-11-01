# 🎫 Engineering Tickets: Ferry Booking Platform End-to-End Integration

> **Target Repositories:**  
> - **Backend:** `c:\Users\Khaled\Khaled Dask\Backend\cpbryn`  
> - **Frontend:** `c:\Users\Khaled\Khaled Dask\Frontend\island-hop`  
> **Date:** 2026-10-20  
> **Status:** READY FOR EXECUTION  

---

## 📋 Ticket Summary Table

| Ticket ID | Category | Title | Severity / Scope | Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **TICKET-01** | Backend | Seed Ferries (Vessels) and Multi-Day Active Schedules in Database | P0 (Blocker) | None | ✅ Completed |
| **TICKET-02** | Backend | Public Trip Details Route & Automatic Payment Record Creation | P0 (Core) | Schema | ✅ Completed |
| **TICKET-03** | Frontend | TanStack Query Integration Layer (`use-trips`, `use-bookings`, `use-tickets`) | P0 (Core) | TICKET-02 | ✅ Completed |
| **TICKET-04** | Frontend | Connect `/book` Results Page with Live Trip Search API | P0 (Storefront) | TICKET-01, 03 | ✅ Completed |
| **TICKET-05** | Frontend | Connect 4-Step Checkout Wizard with Live Atomic Booking Mutation | P0 (Storefront) | TICKET-03, 04 | ✅ Completed |
| **TICKET-06** | Frontend | Connect Digital Boarding Pass (`/tickets/:ref`) & Self-Service Portal (`/manage-booking`) | P1 (Feature) | TICKET-05 | ✅ Completed |
| **TICKET-07** | QA & Test | End-to-End Verification: Search ➔ Booking ➔ DB Invariants ➔ Digital Pass | P0 (Release) | TICKET-01..06 | ✅ Completed |

---

## 🎯 Detailed Ticket Specifications

### 🏷️ TICKET-01: Seed Ferries & Multi-Day Schedules
- **Component:** Backend Seeder (`prisma/seed.ts`)
- **Problem Statement:**  
  Currently `seed.ts` only seeds ports, users, operator profiles, and routes. There are **zero Ferries** and **zero Schedules** in the database. When someone searches on today or future dates, the API returns `[]` empty results.
- **Scope & Implementation:**
  1. Add 8-10 realistic Ferry vessels across the 5 seeded operators (e.g. *Ocean Speed 1*, *Atoll Express 2*, *Catamaran Cruiser*, capacity: 30 to 65 seats, type: `SPEEDBOAT` / `CATAMARAN`).
  2. Generate daily recurring schedules for the next 30 days across active routes (especially *Malé ⇄ Maafushi*, *Malé ⇄ Thulusdhoo*, *Malé ⇄ Gulhi*, *Malé ⇄ Dhiffushi*).
  3. Set realistic departure times (e.g. 08:30 AM, 11:00 AM, 02:00 PM, 04:30 PM), fares ($25 adult, $15 child), and `availableSeats = capacity`.
  4. Run seeder (`npm run seed`).
- **Acceptance Criteria:**
  - `GET /api/v1/trips/search?from=port-male&to=port-maafushi&departureDate=TODAY&adults=1` returns active matching trips with prices and seats.

---

### 🏷️ TICKET-02: Public Trip Details API & Payment Record Creation
- **Component:** Backend Modules (`src/app/modules/schedule`, `src/app/modules/booking`)
- **Problem Statement:**  
  1. `GET /api/v1/schedules/:id` requires `auth(OPERATOR, ADMIN)`. Guest passengers reviewing a trip in Step 1 cannot fetch trip summary without logging in.
  2. `BookingService.createBooking` decrements seats and generates tickets atomically, but does not populate the `Payment` table.
- **Scope & Implementation:**
  1. Add public route `GET /api/v1/trips/:id` (or permit guest access on `GET /schedules/:id`) that returns single trip details (vessel name, departure/arrival timestamps, adult/child fares, remaining seats, operator name).
  2. Inside `prisma.$transaction` in `BookingService.createBooking`, create a `Payment` record linked to the booking:
     - `amount = calculatedTotalAmount`
     - `platformCommission = calculatedTotalAmount * 0.10` (10% platform take-rate)
     - `operatorPayout = calculatedTotalAmount * 0.90` (90% operator payout)
     - `status = PaymentStatus.COMPLETED`
     - `paymentMethod = "CARD"`
     - `paidAt = new Date()`
- **Acceptance Criteria:**
  - Unauthenticated GET to `/api/v1/trips/:id` returns 200 OK with trip details.
  - Creating a booking creates 1 `Booking`, N `Ticket`s, and 1 `Payment` in a single atomic transaction.

---

### 🏷️ TICKET-03: Frontend Integration Layer (Hooks & Types)
- **Component:** Frontend Hooks (`src/hooks/use-trips.ts`, `src/hooks/use-bookings.ts`, `src/hooks/use-tickets.ts`)
- **Problem Statement:**  
  Frontend lacks dedicated React Query hooks for public trips search, checkout booking mutations, and digital passes.
- **Scope & Implementation:**
  1. Create `src/hooks/use-trips.ts`:
     - `tripKeys` query key factory.
     - `useTripsSearchQuery(params)` -> calls `GET /api/v1/trips/search`.
     - `useTripDetailsQuery(tripId)` -> calls `GET /api/v1/trips/:id`.
  2. Create `src/hooks/use-bookings.ts`:
     - `bookingKeys` query key factory.
     - `useCreateBookingMutation()` -> calls `POST /api/v1/bookings` with payload, invalidates trip & seat caches.
     - `useBookingLookupQuery(reference)` -> calls `GET /api/v1/bookings/manage/:reference`.
     - `useCancelBookingMutation()` -> calls `PATCH /api/v1/bookings/:id/cancel`.
  3. Create `src/hooks/use-tickets.ts`:
     - `useDigitalPassQuery(identifier)` -> calls `GET /api/v1/tickets/pass/:identifier`.
  4. Export all hooks through `src/hooks/index.ts`.
- **Acceptance Criteria:**
  - All hooks are type-safe with `@/types`, handling loading, error, and cached revalidation states.

---

### 🏷️ TICKET-04: Connect `/book` Results Page with Live Search API
- **Component:** Frontend Page (`src/app/(marketing-and-booking)/book/page.tsx` & `FerryCard.tsx`)
- **Problem Statement:**  
  Currently `/book/page.tsx` parses query parameters via `bookingSearchParamsCache`, but maps over a static mock array `AVAILABLE_FERRIES`.
- **Scope & Implementation:**
  1. Update `/book/page.tsx` to pass active query parameters (`from`, `to`, `departureDate`, `tripType`, `adults`, `children`) to client components or fetch via `useTripsSearchQuery`.
  2. Replace static list with live `outboundTrips` and `returnTrips`.
  3. Render Skeleton loading states while fetching and a friendly "No ferries found" empty state if no trips match.
  4. Update `FerryCard.tsx` to render live data: operator company name, vessel name, departure/arrival times, duration, live available seats, and total price.
  5. Ensure "Select Trip" CTA button correctly routes to `/book/:tripId/review?passengers=...&departureDate=...`.
- **Acceptance Criteria:**
  - Search from Hero Section lands on `/book` and displays real ferry trips queried from PostgreSQL.

---

### 🏷️ TICKET-05: 4-Step Checkout Wizard Full Integration
- **Component:** Frontend Pages (`review/page.tsx`, `passengers/page.tsx`, `payment/page.tsx`, `confirmation/page.tsx`)
- **Problem Statement:**  
  The checkout wizard currently uses mock arrays, dummy random reference IDs, and sessionStorage rather than the live backend API.
- **Scope & Implementation:**
  1. **Step 1 (Review):**
     - Fetch live trip details with `useTripDetailsQuery(tripId)`.
     - Display live vessel, departure/arrival timestamps, and live price recalculations.
  2. **Step 2 (Passengers):**
     - Enhance passenger form fields to include: Full Name, Nationality, and Passport / National ID Number for each traveler.
     - Validate inputs using Zod matching `BookingValidation.createBookingZodSchema`.
  3. **Step 3 (Payment):**
     - Replace fake timeout and random string with `useCreateBookingMutation()`.
     - On successful booking response, navigate to Step 4 with the real booking reference: `/book/:tripId/confirmation?ref=${booking.reference}`.
  4. **Step 4 (Confirmation):**
     - Fetch live booking details via `useBookingLookupQuery(ref)`.
     - Display real QR code containing the digital pass link (`/tickets/${booking.reference}`), verified tickets list, and download buttons.
- **Acceptance Criteria:**
  - Submitting payment creates real records in PostgreSQL and renders a valid confirmation screen with genuine booking reference (e.g. `FRY-20261020-XXXX`).

---

### 🏷️ TICKET-06: Digital Boarding Pass & Self-Service Portal Integration
- **Component:** Frontend Pages (`tickets/[bookingRef]/page.tsx`, `manage-booking/[bookingRef]/page.tsx`)
- **Problem Statement:**  
  Tickets and Manage Booking pages currently render static mock objects from `@/data/bookings`.
- **Scope & Implementation:**
  1. Connect `/tickets/:bookingRef` with `useDigitalPassQuery` to show the passenger boarding pass with seat letter, vessel name, captain, departure gate, and live QR code.
  2. Connect `/manage-booking` lookup with `useBookingLookupQuery` to search bookings by reference + email.
  3. Enable ticket cancellation via `useCancelBookingMutation` with proper confirmation modal.
- **Acceptance Criteria:**
  - Any passenger can look up their real booking reference and view or download their boarding pass.

---

### 🏷️ TICKET-07: End-to-End Verification & Validation
- **Component:** Full Stack E2E Testing
- **Execution Checklist:**
  1. **Seeding:** Confirm PostgreSQL has ports, operators, ferries, and schedules.
  2. **Homepage Search:** Select *Malé* ➔ *Maafushi* on today's date with 2 Adults.
  3. **Results:** Verify results page displays live vessels with seat counts and accurate prices.
  4. **Checkout:** Complete Step 1 ➔ Step 2 (enter passenger names & IDs) ➔ Step 3 (Pay).
  5. **DB Verification:** Verify `availableSeats` in `Schedule` decremented by 2; verify `Booking`, `Ticket`, and `Payment` records created.
  6. **Confirmation & Digital Pass:** Verify QR pass and manage booking portal work with the created reference.
