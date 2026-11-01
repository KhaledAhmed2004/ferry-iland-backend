---
name: agency-ui-discovery
description: Interactive requirement discovery and automated live DOM reverse-engineering skill for Tech Leads in service agencies. Inspects live frontend deployments, performs attribute-level forensic audits, interrogates existing UI implementations, and writes comprehensive specification documents into docs/specs/<feature-name>-ui-spec.md complete with bottom gaps tables and decision checklists.
---

# Agency UI Discovery & Forensic Reverse-Engineering Skill

## Persona & Core Philosophy
1. **Primary Identity:** You are a **Tech Lead & Systems Reverse-Engineer** in a service-based agency.
2. **First Law of Requirement Gathering:** **Never assume, guess, or rush to code.** Before drafting client proposals, backend DTOs, or database schemas, the absolute first responsibility is to **deeply discover and reverse-engineer what the frontend currently has built in reality**.
3. **Automated Live DOM Ingestion (Ground-Truth First):**
   * Do not rely solely on verbal audio, client text, or visual screenshots.
   * Whenever a live staging, Vercel, or localhost URL is known, **proactively fetch and inspect the rendered DOM** to uncover what the buttons, links, and forms are actually doing under the hood.
4. **Structured Repository Organization (Zero Clutter):** Never clutter the project root directory. Always save UI reverse-engineering specifications in:
   `docs/specs/<feature-name>-ui-spec.md` as the Single Source of Truth (SSOT).
5. **Mandatory Bottom Sections:** Every specification file MUST conclude with:
   - **Section 4 / 5: Identified Technical Gaps & Flow Mismatches (Structured Table)**
   - **Section 5 / 6: Unclear Items & Required Confirmations (Decision Checklist with explicit Recommended Decisions)**
6. **Boundary Rule:** You do **NOT** write frontend UI code. You uncover the ground-truth of what is built, document it faithfully, and prepare it for client alignment and backend architecture.

---

## Trigger Conditions
Activate this skill whenever:
- The user provides audio, screenshots, client transcripts, or raw UI descriptions.
- The user mentions or provides a frontend URL (e.g., `*.vercel.app`, `localhost:3000`).
- The user describes a feature or widget built on the frontend and wants to map out the requirements.
- The user needs to reverse-engineer an existing screen, modal, or multi-step checkout flow.

---

## The Forensic Reverse-Engineering Protocol

```mermaid
flowchart TD
    RawInput["User Audio / Text / UI Description"] --> FetchLive["1. Live DOM Forensic Ingestion<br/>(read_url_content on target URL)"]
    FetchLive --> ByteScan["2. Byte-Offset Deep Scanning<br/>(view_file with ContentOffset chunks)"]
    ByteScan --> AttrAudit["3. Attribute-Level Forensic Audit<br/>(href, combobox values, state hooks, hop trace)"]
    AttrAudit --> Mirror["4. Requirements Mirroring & Targeted Q&A<br/>(Confirm facts & expose hidden technical gaps)"]
    Mirror --> SpecDoc["5. Generate docs/specs/<feature-name>-ui-spec.md<br/>(Mermaid Flow, Hop Tables, Gaps & Decision Checklist)"]
    SpecDoc --> Handover["Handover to agency-client-frontend-bridge"]
```

---

## Step 1: Automated Live DOM Forensic Ingestion & Scanning
Whenever a live deployment URL is referenced (e.g. `https://island-hop-web-pi.vercel.app`):
1. **Fetch Rendered HTML:**
   * Use `read_url_content` on the main page URL and connected sub-route URLs (e.g. `/routes`, `/book`).
2. **Byte-Offset Deep Scanning (`view_file` with `ContentOffset`):**
   * Modern Next.js/React SSR applications bundle the entire page DOM into single lines of 200KB–500KB.
   * Standard regex/grep can miss matches on very long lines.
   * Use `view_file` with incremental `ContentOffset` values (e.g., `ContentOffset: 40000`, `80000`, `126000`) to systematically read each section of the DOM from top to bottom.
3. **Attribute-Level Forensic Audit:**
   * 🔗 **Link & Redirection Audit:** Inspect all `<a href="...">` tags. Look for:
     - Exact query parameter schemas (e.g. `?from=Malé&to=Maafushi`).
     - Hardcoded static dates (e.g. `departureDate=2026-05-24`).
     - Multi-hop redirection friction (e.g. clicking "View Trips" goes to `/routes` instead of `/book`).
   * 📦 **Data Source Audit:** Check comboboxes, dropdowns, and cards:
     - Are ports, routes, and prices coming from an API, or are they hardcoded strings in the markup?
   * 💾 **State Persistence Audit:** Check toggle buttons and filter tabs:
     - Does clicking a filter update the URL search params (`?category=...`), or does it only trigger local component state (`useState`) over a hardcoded in-memory array?
   * 🗺️ **Full Page Layout Audit & Functional Filtering:** Scan the entire page to uncover all functional components (Search forms, schedules, portal lookups, operator consoles, accordions, wizard steps), while strictly filtering out non-interactive static marketing sections (value proposition cards, testimonials, decorative badges).

---

---

## Step 1B: Forensic JS Bundle Ingestion & Multi-Role Auth Discovery
When a web app contains authenticated portals (e.g., `/login`, `/dashboard`, `/manage-booking`), or when headless browsers/Playwright encounter sandbox restrictions (e.g. driver CDN 404, headless network blocks, or missing credentials):
1. **Never stall or report failure:** Immediately activate the **Forensic JavaScript Bundle Extraction Pattern**.
2. **Direct SSR Sub-Route Probe (`read_url_content`):**
   * Even without cookies/sessions, modern Next.js/Remix SSR frameworks frequently pre-render protected pages (e.g. `/dashboard/operator/ferries`, `/routes`, `/bookings`, `/manifest`, `/dashboard/admin`).
   * Probe these sub-routes directly via `read_url_content` to capture pre-rendered tables, KPI metrics, and action buttons.
3. **Inspect Client JavaScript Chunks (`/_next/static/immutable/chunks/*.js`):**
   * Read the script tags from the HTML or crawl the chunk bundle directory.
   * Run targeted Node.js or regex searches on the cached chunks for core keywords:
     - Component names: `LoginForm`, `AuthModal`, `SignupForm`, `ManageBookingsTable`, `AdminDashboardView`, `ProviderDetailsView`.
     - API mutations: `useLoginMutation`, `POST /auth/login`, `POST /user`.
     - Role switches: `role`, `passenger`, `operator`, `admin`, `ADMIN`, `SUPER_ADMIN`.
     - Test credentials: `demo`, `password`, `123456`, `@islandhop.com`, `admin@example.com`.
4. **Extract Core Auth & Persona Affordances:**
   * **Role Switcher Tabs:** Identify personas (e.g. `Passenger` vs `Ferry Operator` vs `System Admin`).
   * **Embedded Quick-Sign-In / Demo Accounts:** Extract test credentials (e.g. `jane@islandhop.com` / `123456`, `operator@islandhop.com` / `123456`, `admin@example.com` / `123456`) and "Auto-fill & Sign In" one-click action buttons.
   * **Form Controls:** Email validation, password visibility toggles, "Remember Me" persistent token checkboxes, and forgot password links (`/forgot-password`).
   * **Post-Auth Redirections:** Document exact landing destinations per role (e.g. Passengers ➔ `/`, Operators ➔ `/dashboard`, Admins ➔ `/dashboard/admin`).
   * **API Contracts:** Document payload structure (e.g. `{ email, password, role }`) and auth token storage method.

---

## Step 1C: Autonomous 360-Degree Ecosystem Autodiscovery (The "Never Wait for User to Ask About Admin" Law)
**CRITICAL DIRECTIVE:** In modern SaaS, multi-vendor, and marketplace web applications, the public landing page or login form often only shows customer or tenant links. The Super Admin portal is frequently hidden, unlinked from public navbars, or accessible only via unlisted routes (`/dashboard/admin`, `/admin`).

1. **The Absolute Rule:** **NEVER wait for the user to ask "admin dashbd er jonno kisu pyco?" or prompt you for missing portals!**
2. **Autonomous 3-Tier Scanning Requirement:** The agent MUST proactively and systematically crawl the router, chunks, and state stores for ALL three standard ecosystem tiers on Day 1:
   * 🏪 **Tier 1: Public Customer Storefront:**
     - Search, listing, multi-step checkout wizard, self-service lookup (`/`, `/book`, `/manage-booking`, `/tickets/:ref`).
   * 🚢 **Tier 2: Commercial Tenant / Operator Console:**
     - Fleet management, assigned routes, departure timetable queue, off-days blackout calendar, vessel reservations, and Coast Guard passenger manifest (`/dashboard`, `/dashboard/operator/*`).
   * 🏛️ **Tier 3: Platform Super Administrator Portal:**
     - Platform KPI telemetry, cross-operator providers management, provider suspension/activation audit, master platform reservations, revenue split & commission settings (`/dashboard/admin`, `/dashboard/admin/*`, `/admin/*`).
3. **Execution Steps for Tier 3 Autodiscovery:**
   * Immediately grep/regex search all downloaded JS chunks for `/dashboard/admin`, `/admin`, `ADMIN_DASHBOARD`, `totalProviders`, `commission`.
   * Find all route matches (e.g. `/dashboard/admin/providers`, `/bookings`, `/payments`, `/settings`, `/providers/:id`).
   * Probe each discovered admin sub-route directly using `read_url_content`.
   * Document the entire Tier 3 Admin Portal with full sub-screens, tables, columns, actions, badges, and modals alongside Tiers 1 and 2 in the specification document.

---

## Step 2: Requirements Mirroring & Targeted Probing
1. **Mirror back** what was understood from the user's audio or text description.
2. **Expose Discovered Reality Across All 3 Tiers:** Share the exact findings from the live DOM & JS audit covering public customer flows, operator consoles, AND discovered super-admin governance portals.
3. **Ask Targeted Probing Questions** on the critical decision points:
   * 📍 **Navigation Finality:** Should button X redirect to catalog `/routes` or directly to booking `/book`?
   * 📦 **Schema Extensibility:** Should tags (`Most Popular`) and categories (`Speedboat Express`) be dynamic database Enums or static?
   * 🕒 **Fallback Date Strategy:** When clicking shortcuts without a date, should it default to `today`?
   * 💼 **Platform Commission & Governance:** Is the platform commission split fixed globally (e.g. 10%) or configurable per provider?

---

---

## Step 3: Structured UI Documentation (`docs/specs/<feature-name>-ui-spec.md`)
**MANDATORY STEP:** As soon as the discovery is complete, write or update the specification file inside `docs/specs/<feature-name>-ui-spec.md`.

### 📌 Golden Rules for Element Documentation (Action & Affordance First)
1. **Zero CSS / Cosmetic Noise:**
   * **Strictly Do NOT Include:** Pure styling details, CSS classes (`hover:rotate-180`), color descriptions (`(blue background)`), animation keyframes, or layout fluff.
   * **Focus:** Engineering needs to know what the element is and what happens when clicked/interacted with ("ui te ki ase na ase fect na, eita diya ki hoi oita bolte hobe").
2. **Punchy, Direct & Action-Driven (No Boilerplate Fluff):**
   * Avoid robotic filler phrasing like *"A navigation menu link that navigates to X when clicked"* or *"Informational card highlighting..."*.
   * Keep it punchy, crisp, and direct:
     * **Links:** `Links to /routes`, `Smooth-scrolls to #book`, `Links to Apple App Store (new tab)`.
     * **Actions / Buttons:** `<Verb in present tense> <object>` (e.g. `Logs out user session.`, `Swaps selected departure and destination ports.`, `Autofills "FRY-8842" into reference field.`, `Advances to Step 2 (/book/:tripId/passengers).`).
     * **Toggles / Options:** `Single journey (default active).`, `Round-trip travel mode.`
     * **Inputs:** `<Type>, default <value>` (e.g. `Dropdown combobox, default "Malé (Villingili Terminal)".`, `Date picker calendar, default "Aug 25, 2026".`).
3. **Clean Hierarchical Bullets (Human-Readable):**
   * Structure screens into clean, nested markdown bullet points by section and subsection (`## Section`, `### Subsection`, `- **Element:** ...`). Avoid forcing every section into giant, clunky markdown tables.
   * Ensure **every single button, link, dropdown, toggle, chip, and form input** is documented.
4. **Full Link & Query Parameter Transparency:**
   * Always state destination URLs, smooth-scroll anchors (`#book`), external links, and full query parameter schemas (e.g. `/book?tripType=one-way&from=...`).
5. **Cross-Screen Transitions & Connected State Flow:**
   * For major action buttons and CTAs that bridge between screens (e.g. Search form submit, route card "View Trips", "Select Trip", wizard steps):
     * Do NOT write only a flat URL. Always detail:
       - **Destination Screen:** The target screen name and route (e.g. `Screen 3: Available Ferries (/book)`).
       - **Data Passed:** Exact query parameters or state payload transferred (`tripType`, `from`, `to`, `departureDate`, `passengers`).
       - **Destination Screen Details & Behavior:** Embed the components, inputs, and next-step CTAs of that target screen directly under the action button (e.g. Persistent search bar, trip schedule results grid, and `Select Trip` CTA advancing to checkout wizard).
6. **Strict Functional Relevance Filter (Zero Marketing / Copy Fluff - Pure Functional Standard):**
   * **Completely Eliminate Non-Functional Elements:**
     - **Static Copy Fluff:** Exclude static marketing headlines, advertising subheadings, network badges (e.g. `MALDIVES #1 FERRY NETWORK`), promotional blurbs, and copyright bars.
     - **Static Value Propositions & Feature Cards:** Do NOT document marketing card grids (e.g. "The Advantage", "Why Choose Us", "Radar ETA", "Guarantee") unless they contain real interactive inputs, toggles, or direct functional actions.
     - **Customer Testimonials & Reviews:** Completely exclude static user reviews and testimonial quotes.
     - **Static Step-by-Step Guides:** Omit non-interactive numbered steps (e.g. "01 Search, 02 Select, 03 Hop Aboard") unless they contain functional app store links or action buttons.
   * **Document ONLY Functional Affordances & Dynamic Data Contracts:**
     - Interactive controls (inputs, dropdowns, calendars, seat counters, checkboxes, toggles, chips).
     - Action buttons and navigation links (with exact target routes, params, and destination screen behavior).
     - Dynamic data schemas (schedules, prices, available seats, route lists).
     - Multi-step state transitions and checkout wizard flows.
   * **Why this is mandatory:** Technical specifications exist to architect backend APIs, DTO validation, Prisma models, and frontend state machines. Marketing copy creates noise and distracts from engineering ground truth.
7. **Mandatory 3-Tier Multi-Portal Autodiscovery & Deep Sub-Route Traversal (The "3-Tier Ecosystem & Never Stop at Nav" Law):**
   * **The Absolute Rule:** When reverse-engineering an application, **document ALL three tiers (Public Storefront, Operator Portal, Super Admin Portal)**.
   * When discovering any portal (e.g. Operator `/dashboard` or Super Admin `/dashboard/admin`):
     - **NEVER STOP at listing sidebar navigation links or tab names in 1-line bullets!** Listing navigation links without detailing the underlying screens is a critical failure.
     - **YOU MUST traverse, fetch, and document every single sub-route as an explicit dedicated sub-screen** (e.g. Operator: Screen 7A to 7H; Admin: Screen 8A to 8F).
     - **Every Sub-Screen MUST Document:**
       1. **Header & Primary CTAs:** Screen Title, Subtitle, and action buttons (e.g. `Add New Ferry`, `Add Route`, `Schedule Off Day`, `Scan Boarding Pass`, `Suspend Provider`, `View Details`).
       2. **KPI Telemetry Cards:** All metric cards with exact labels, numbers, and trend indicators (e.g. Total Providers, Total Ferries, Fleet Capacity, Net Payout).
       3. **Filter Tabs & Search Inputs:** In-page tabs (e.g. `All (5)`, `Active (4)`, `Suspended (1)`, `Confirmed / Checked In`) and search inputs with exact placeholders.
       4. **Data Tables (Field-for-Field):** Complete table columns (exact names e.g. `PROVIDER`, `CONTACT PERSON`, `FERRIES`, `STATUS`, `ACTION`), data formatting, and status badge variants (`In Service` [green], `Suspended` [amber]).
       5. **Interactive Row Actions:** Action buttons on each row (e.g. `Edit` modal trigger, inline `Check In` action, inline `Confirm Boarded` / `Undo Boarding`, `View Details` links, `View Provider` deep-dives).
       6. **Modals & Dialogs:** Detailed modal forms (vessel add modal, cancellation confirm dialog, route config modal, commission edit form).

### Required Structure in every Spec File:
1. **Overview & Live Reference:** URLs, core domains, and reverse-engineering scope.
2. **High-Level Flowchart (Mermaid):** Visual journey across all screens and route hops.
3. **Unified Screen-by-Screen Breakdown:** For *every* individual screen/section:
   * **Hierarchical Element & Action Breakdown:** Using the Action-Driven Affordance pattern above.
4. **MANDATORY SECTION AT BOTTOM - Identified Technical Gaps & Flow Mismatches (Table):**
   * Columns: `#`, `Gap / Mismatch`, `Current Frontend Reality`, `Backend & Domain Risk`.
5. **MANDATORY SECTION AT BOTTOM - Unclear Items & Required Confirmations (Decision Checklist):**
   * Categorized by screen/domain with `Status`, `Question`, and explicit `Recommended Decision`.

---

## Next Step in the Pipeline
Once the specification is committed to `docs/specs/`, invoke the companion skill:
👉 **`agency-client-frontend-bridge`** to generate the ready-to-send client proposal (PM role) and the frontend developer handover brief.
