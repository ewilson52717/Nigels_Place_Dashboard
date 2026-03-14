# Nigel's Place PawDesk — Changelog

## [Unreleased] — 2026-03-14

### Fixed
- **Invalid Date bug** — Booking dates from Google Sheets (via Apps Script proxy) were serialised as ISO datetime strings (e.g. `2026-03-15T07:00:00.000Z`). The `fmtDateShort` and `fmtDate` helpers appended `T00:00:00` to the already-timestamped string, producing `Invalid Date`. Fixed with:
  - `sheetDateStr()` now strips time from ISO datetime strings
  - New `_safeDate()` helper used by `fmtDate`/`fmtDateShort` — extracts date-only portion and returns `'—'` instead of `Invalid Date` for unparseable values
  - `loadClientDataViaProxy()` now normalises dates through `sheetDateStr()` (matching admin path)
  - Server-side `getClientData()` in the proxy now converts Date objects to `yyyy-MM-dd` before JSON serialisation

### Added
- **Unpaid booking detection system** — `getUnpaidBookings(clientId)` computes urgency based on payment deadlines:
  - Boarding: deposit due 7 days before check-in
  - Daycare: full payment due 24 hours before session
  - Three urgency levels: `normal`, `urgent` (within 2 days of deadline), `overdue` (past deadline)

- **Persistent unpaid alert banner** — Non-dismissible banner shown at the top of the client portal when any bookings are unpaid. Colour-coded by urgency (amber → orange → red). Includes a soft-pulsing "Pay Now →" button.

- **Payables & Balances section in My Account** — Shows outstanding unpaid bookings with urgency indicators, Pay Now links, and recent payment history. Payment policy summary included.

- **Admin "At Risk" flag** — In the calendar day modal, admin sees a red blinking "⚠️ At Risk — unpaid" label on bookings past their payment deadline (replaces generic "Awaiting payment").

- **Payment & Deposit Policy in Terms of Service** — Added new section covering:
  - 25% boarding deposit due 7 days before check-in
  - Daycare payment due 24 hours before session
  - Session packages paid at purchase
  - Forfeiture policy for unpaid bookings
  - Updated both the in-app terms modal and the standalone `terms-of-service.html`

- **Multi-dog family booking** — Clients with multiple dogs can select 2–3 dogs for a single booking that shares 1 kennel/capacity slot:
  - Multi-dog checkbox UI replaces single-dog dropdown when client has >1 active dog
  - Max 3 dogs per family booking (shared kennel limit)
  - `familyDogIds` stored as comma-separated string on the booking record (column R)
  - Family pricing applied across all service paths: boarding, daycare, combo, and custom
  - Vaccine check validates all selected dogs before booking
  - Price preview updates live as dogs are checked/unchecked
  - Day modal shows "🐾 family" tag on family bookings
  - `booksForDate()` already counts family bookings as 1 slot (single record)

- **Multi-pet discount** — First dog pays full price, additional dogs get a configurable % off:
  - `familyPrice(basePricePerDog, dogCount)` helper calculates family total
  - Default discount: 10% off each additional dog
  - Admin-configurable via Settings → Multi-Pet Family Booking → "Discount for Additional Dogs (%)"
  - `multiPetDiscount` setting persisted in Settings sheet (row 19) and synced to clients via proxy

- **Booking detail enhancements for client day modal** — Clients now see service type, icon, price, date range, and add-ons in the calendar day modal (previously only dog name was shown)

- **Confirm & Pay Now flow refinement** — Client-initiated bookings show "Confirm & Pay Now" overlay; persistent unpaid banner reserved for admin-created (phone/manual) bookings only via `createdBy` tracking

---

## [2026-03-13] — Commit e58eddb

### Added
- **My Packages** section in client account profile — shows remaining sessions, purchase history, bulk pricing tiers
- **Buy Sessions** button and modal for purchasing daycare session packages
- **Pay Now banner** — full-screen overlay after booking with Square checkout link
- **Revenue ticker fixes** — corrected weekly revenue calculation

---

## [2026-03-09 – 2026-03-12] — Earlier development

### Core features built
- Single-page dashboard (`happypaws-dashboard.html`) with admin + client + kiosk roles
- Google OAuth authentication with role-based access
- Google Sheets as database (Clients, Dogs, Bookings, Settings, Services, Packages)
- Google Apps Script proxy for secure client writes
- Calendar with capacity tracking, day-off management, capacity overrides
- Booking system: daycare, boarding, combo, custom services, add-ons
- Client onboarding flow with profile versioning
- Vaccine record management with Gemini AI scanning
- Vet clinic lookup with Google Maps Places API
- Square payment integration (sandbox) with checkout link generation
- Invoice system with AI-assisted descriptions
- Kiosk mode for lobby display
- Privacy Policy and Terms of Service modals + standalone pages
