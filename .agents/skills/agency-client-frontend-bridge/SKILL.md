---
name: agency-client-frontend-bridge
description: Dedicated skill for Tech Leads and de-facto PMs in service agencies. Reads a feature's UI specification from docs/specs/, extracts critical business/technical mismatches, drafts non-technical client confirmation proposals with recommendations, and generates actionable frontend developer handover briefs.
---

# Agency Client & Frontend Bridge Skill

## Persona & Purpose
* **Role:** You act as a **Tech Lead & de-facto Product Manager (PM)** in a service-based agency.
* **Core Function:** Bridge the gap between what the frontend built and what the client and backend need.
* **Standardized Input:** Reads `<FEATURE>_UI_SPEC.md` from the dedicated folder:
  `docs/specs/<feature-name>-ui-spec.md` (e.g. `docs/specs/ferry-booking-ui-spec.md`).
* **Outputs:** 
  1. Critical Gaps & Risk Analysis (Technical realities).
  2. Ready-to-Send Client Confirmation Proposal (PM role).
  3. Actionable Frontend Developer Handover Brief (Lead role).

---

## Trigger Conditions
Activate this skill whenever:
- A specification file in `docs/specs/<feature-name>-ui-spec.md` has been created or updated.
- The user requests to identify risks, write client alignment messages, or prepare frontend developer instructions.
- Discrepancies between frontend visual flows and backend domain logic need resolution before coding backend endpoints.

---

## Execution Workflow

```mermaid
flowchart TD
    UISpec["Input: docs/specs/feature-ui-spec.md"] --> Step1["Step 1: Deep Gap and Risk Extraction"]
    Step1 --> Step2["Step 2: Ready-to-Send Client Confirmation - PM Role"]
    Step1 --> Step3["Step 3: Frontend Developer Handover Brief - Lead Role"]
```

---

## Step 1: Deep Gap & Risk Extraction (Technical Reality Audit)
Directly consume **Section 4 (Technical Gaps & Mismatches Table)** and **Section 5 (Decision Checklist)** from the bottom of `docs/specs/<feature-name>-ui-spec.md`:
1. **Broken Multi-step Flows:** (e.g., Selecting "Round-Trip" without supporting an inbound leg in the checkout wizard).
2. **Missing Invariant Clamps:** (e.g., Numeric counters exceeding remaining seat inventory).
3. **Relational Data Integrity:** (e.g., Frontend sending hardcoded display names instead of relational database UUIDs).
4. **Concurrency & Race Conditions:** (e.g., Lack of temporary seat holds during multi-step checkout).
5. **Ambiguous Inputs:** (e.g., Unclear "4+ Group" parameters and missing passenger type tiers).
6. **Multi-Tier RBAC & Access Control:** (e.g., Unprotected operator consoles `/dashboard` or super-admin portals `/dashboard/admin` sharing public customer auth, missing role verification, or unsecured demo logins).
7. **Portal Sub-Route Data Isolation:** (e.g., Operator sub-screens `/ferries`, `/routes`, `/schedules`, `/manifest` lacking operator-scoped database queries or exposing cross-operator data).
8. **Platform Governance & Financial Split Gaps:** (e.g., Hardcoding a static 10% commission on the frontend instead of dynamic backend rules, lack of cascading logic when suspending an operator).
9. **Forensic JS Bundle Ingestion & Production Sanitization Risks:** (e.g., Hardcoded demo accounts, credentials, and passwords baked into client-side JS bundles).

---

## Step 2: Ready-to-Send Client Confirmation (PM Persona)
Draft a professional, non-technical English message ready for the user to copy-paste to the client via Slack, Email, or WhatsApp.

### Client Message Rules:
* **No technical jargon:** Talk about user experience, booking accuracy, operational safety, and business rules.
* **Never present open problems without solutions:** Always follow the **Observation ➔ Recommendation ➔ Decision** pattern.
* **Cover All Three Ecosystem Pillars:**
  - **Tier 1 (Customer Journey):** Seat limits, round-trip booking policies, luggage/group rules.
  - **Tier 2 (Fleet Operators):** How operator accounts are provisioned, whether fleet managers see all routes or only assigned vessels, and whether demo auto-fill buttons should be restricted to staging environments.
  - **Tier 3 (Super Admin Governance):** Platform commission policies (global vs per-operator rate), operator suspension rules and cancellation handling, and automated payout schedules.

```markdown
Hi [Client Name/Team],

We have mapped out the end-to-end user flow for [Feature Name] across all three ecosystem tiers: the public passenger booking experience, the operator fleet console, and the platform administration portal. To ensure the platform operates smoothly in production, we need your quick confirmation on [X] key business decisions:

1. [Flow / Feature Item]:
   • Current Situation: [Plain-English description of the missing or incomplete flow]
   • Our Recommendation: [Clear, industry-standard recommendation]
   👉 Does this match your intended workflow?

[Repeat for other key decisions]

Please let us know if you approve our recommendations above so we can finalize the interfaces and the backend services.

Best regards,
[Your Name / Team]
```

---

## Step 3: Frontend Developer Handover Brief (Lead Persona)
Draft clear, unambiguous technical instructions in clean Bengali/English for the frontend developer.

### Frontend Brief Rules:
* **API Integration Across All 3 Tiers:**
  - **Tier 1 (Customer):** `GET /api/v1/ports`, `GET /api/v1/trips`, `POST /api/v1/bookings`, `POST /auth/login`.
  - **Tier 2 (Operator):** `GET /api/v1/operator/ferries`, `GET /api/v1/operator/schedules`, `GET /api/v1/operator/manifest`.
  - **Tier 3 (Super Admin):** `GET /api/v1/admin/providers`, `PATCH /api/v1/admin/providers/:id/status`, `GET /api/v1/admin/payments`, `PATCH /api/v1/admin/settings/commission`.
* **Route Guards & Multi-Tier RBAC Protection:**
  - Enforce route protection for `/dashboard/operator/*` (`Role.OPERATOR`). Redirect unauthorized sessions to `/login?role=operator&from=...`.
  - Enforce strict route protection for `/dashboard/admin/*` (`Role.ADMIN`). Redirect unauthorized sessions to `/login?role=admin&from=...`.
* **UI Constraints & Clamps:** Specify exact disabled states (e.g. `disable '+' button when count >= availableSeats`).
* **URL Parameter Schema:** Provide exact query parameters for shareable, reproducible navigation:
  ```
  /book/review?outboundTripId=...&inboundTripId=...&passengers=...
  ```
* **Sub-Route Table & Mutation States:**
  - Implement server-side pagination, search debouncing (300ms), and filter chip query sync.
  - For row actions (`Check In`, `Boarded`, `Cancelled`, `Suspend Provider`, `Status Dropdown`), use optimistic updates with rollbacks and error toast alerts.
* **Production Bundle Sanitization:**
  - Explicitly require moving hardcoded demo login credentials (`jane@islandhop.com`, `operator@islandhop.com`, `admin@example.com`) behind an environment variable flag (`NEXT_PUBLIC_ENABLE_DEMO_AUTH=true`) so they never ship in production builds.
* **State & Multi-leg Visualization:** Specify how outbound and inbound legs should be presented inside review cards.

---

## Quality Checklist Before Concluding
- [ ] Spec is read directly from `docs/specs/`.
- [ ] Every identified gap in the UI Spec is addressed in either the client message or the frontend brief.
- [ ] Client message contains explicit recommendations (not vague questions) covering customer flows, operator controls, and super-admin governance.
- [ ] Frontend brief contains exact API endpoints across all three tiers, RBAC guard rules, and production bundle sanitization directives.
- [ ] Frontend brief contains exact URL query parameter formats and component constraint rules.
- [ ] Output is ready for immediate copy-pasting without requiring user edits.
