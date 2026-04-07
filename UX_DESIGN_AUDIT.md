# Nigel's Place — PawDesk UX/Design Audit

**Date:** April 6, 2026
**Reviewer:** Claude (AI Design Audit)
**App URL:** https://ewilson52717.github.io/Nigels_Place_Dashboard/happypaws-dashboard.html

---

## Executive Summary

PawDesk is a surprisingly full-featured single-page app for a dog daycare business. The visual design has a strong foundation — the dark indigo sidebar, warm peach background gradient, and rounded card-based layout create a friendly, modern feel. However, there are several UX and design issues across views that would improve professionalism, usability, and Kelly's day-to-day experience.

**Overall Score: 7/10** — Strong bones, needs polish.

---

## 1. Login / Loading Screen

**What works well:**
- Clean, centered login card with the Nigel's Place logo is warm and inviting
- Google SSO button is clear and familiar
- "Privacy Policy" and "Terms of Service" links build trust
- Loading spinner with logo feels branded

**Issues to address:**

- **Loading screen has no progress indicator** — "Loading your data..." with a spinner gives no sense of whether it'll take 2 seconds or 30. Consider a skeleton screen or progress bar showing stages (auth → fetching clients → fetching bookings → done).
- **No error state visible** — If the Apps Script proxy is down or slow, the user just stares at the spinner forever. Add a timeout message like "Taking longer than expected — check your connection" after ~10 seconds.
- **"Use a different account" link styling** — It's subtle gray text that could be missed. Slightly bolder styling would help.

---

## 2. Admin Dashboard (Home)

**What works well:**
- The greeting ("Good evening 🐾") with the date feels personal and grounding
- Six stat cards at the top give an at-a-glance summary
- "Today's Roster" and "Upcoming — Next 3 Days" side-by-side is great for a morning overview
- Invoice summary at the bottom with red "Overdue" badge is attention-grabbing
- The purple "+ New Booking" button is prominent and well-placed

**Issues to address:**

- **Stat cards overflow horizontally** — Six cards in a row get cramped on smaller screens. The "This Week Revenue" card with "tap for breakdown" text is the widest and could cause wrapping. Consider collapsing to 2 rows of 3, or making the cards responsive.
- **"0/7" format is ambiguous** — Does "0/7" mean 0 pets checked in out of 7 capacity? This should be labeled more clearly, like "0 of 7 spots" or "0/7 capacity."
- **Warning triangle (⚠️) on Overdue Balance** — Good attention-grabber, but there's no color-coded severity. $0.00 overdue still shows the yellow triangle. It should only appear when the balance is actually > $0.
- **"Available" text under "Pets Today"** — The green "Available" label is redundant when showing 0/7. The capacity context already communicates availability.
- **FAB button (purple +)** — The floating action button in the bottom right overlaps with the Invoices section when scrolled down. Its purpose is also unclear — does it create a booking? An invoice? A pet? Add a tooltip or label.

---

## 3. Calendar / Schedule View

**What works well:**
- Color-coded availability legend (green/orange/red) is intuitive
- "Describe to AI" natural language date blocking is a standout feature
- Block date range and custom capacity controls are well-organized
- Calendar grid is clean with clear day labels

**Issues to address:**

- **Top section is very tall** — The block controls, AI input, and custom capacity take up more than half the viewport before you even see the calendar. On Kelly's iPad/laptop, she'd have to scroll down to see any dates. Consider collapsing these into an expandable panel or moving them to a side drawer.
- **"All Closed / Custom Days" panel** — The three closed dates listed on the right are helpful, but the "Select all" checkbox implies bulk deletion. This is a destructive action that should have a confirmation dialog.
- **"Same-day" badge on today (April 6)** — The red "🚫 Same-day" badge is good but could be confusing. Does it mean same-day bookings are closed, or the whole day is closed? A tooltip would help.
- **"Open" labels on calendar days** — Every open day says "Open" in light gray. This is visual noise — the absence of a closure indicator already means it's open. Only show labels for notable states (closed, custom capacity, filling up).
- **Calendar doesn't show booking counts** — The admin can't see at a glance which days have 3/7 pets vs 0/7. Adding a small count like "2/7" in each cell would make this much more useful.

---

## 4. Pets View (List + Detail)

**What works well:**
- Pet cards with photo, breed, age, owner name, and notes are clear
- Green checkbox (✅) for vaccine status is immediately visible
- Pet detail view has a great two-column layout — pet info on left, records/care on right
- Care Profile section with "🎙️ Brain Dump" and "✏️ Edit Fields" buttons is exactly what Kelly needs
- The empty state CTA ("No care profile yet — Tap Brain Dump") is well done

**Issues to address:**

- **Duplicate "Odin" entries are confusing** — Two cards both named "Odin" (same breed, same age) but different owners (Elyse Wilson vs Jonathan Wilson) need better visual differentiation. Adding the owner's initial/avatar color to the card border or a more prominent owner label would help.
- **Pet card notes show raw data** — The third Odin card shows "None Gender: Male Emergency Contact: Elyse Wilson — 804-370-4518" as a quoted string. This looks like debug output, not formatted notes. Parse and display these as structured fields.
- **"View Profile →" link placement** — It's right-aligned at the bottom of each card, but the card itself isn't obviously clickable. Either make the whole card clickable (with a subtle hover effect) or make the link more prominent.
- **Birthday format** — "Birthday: 2026-09-15" shows ISO format. Use a friendlier format like "Sep 15, 2026" or even "Born Sep 15, 2026 (< 1 month old)".
- **Vaccine override banner is very wide and red** — The "Vaccine requirement overridden — Indefinitely waived" banner dominates the right column. Consider a more subtle yellow/amber alert style since this is informational, not an error.
- **"0 visits" badge** — This shows in red-ish styling. For a new pet, zero visits isn't alarming — it's expected. Use neutral gray styling for zero.

---

## 5. Invoices & Payments View

**What works well:**
- Three summary cards (Total Owed, Collected, Outstanding) provide instant context
- Color coding — green for collected, red for outstanding — is intuitive
- Individual invoice cards with action buttons (Text, Email, Mark as Paid) are functional
- Square Payments reconciliation section at the bottom is well-separated
- "Delete" button for cleanup is accessible but not too prominent

**Issues to address:**

- **"Collected: $0.00 — 0% collected" is confusing** — If there's $0.03 owed and $0.00 collected, the "0% collected" label is technically correct but the green card color suggests everything is fine. Consider making the card yellow/amber when collection rate is low.
- **Header buttons are crowded** — "Daily Sheet," "Clear All," "Sync," and "+ New Invoice" all compete for attention in the top right. "Clear All" is a destructive action sitting right next to "Sync" — too easy to click the wrong one. Move "Clear All" to a settings/overflow menu, or add a red color and confirmation dialog.
- **Invoice progress bar** — The thin gray line under "Mike Hunt" appears to be a 0% progress bar. It's so subtle it's almost invisible. Either make it more visible or remove it if it's not adding value.
- **"Was due Apr 3" with warning triangle** — Good urgency indicator. But the overdue badge ("🔴 overdue") and the "⚠️ Was due Apr 3" text are redundant. Pick one.
- **Square Payments section is empty by default** — "Click Load from Square to see recent payments" is fine, but consider auto-loading on page visit since Kelly will always want to see this.

---

## 6. Kiosk View

**What works well:**
- The dark purple/indigo theme is visually distinct from the admin — immediately signals "different mode"
- Live clock in the top right is a nice touch for a wall-mounted display
- "Export PDF" button and "Fullscreen" button are well-placed
- "Coming Up" sidebar panel is useful for at-a-glance scheduling
- "No guests today / Check back soon!" empty state is friendly

**Issues to address:**

- **Admin sidebar is still visible** — When Kelly puts this on a tablet for staff, the full admin nav (Dashboard, Calendar, Clients, etc.) is showing on the left. The kiosk should hide the sidebar completely or go true fullscreen automatically.
- **"Preview · live data" label at bottom** — This is confusing for staff. Is it a preview or is it live? Remove the "Preview" label if it's showing real data.
- **"Coming Up" panel only shows a moon icon** — The "All clear this week" state with a moon emoji feels like a placeholder. When there ARE upcoming bookings, this needs to show dog names, dates, and care alert badges.
- **No staff interaction affordances** — The kiosk should have check-in/check-out buttons for each dog card. Currently it's display-only. Staff need to tap a dog to mark them arrived/departed.

---

## 7. Client View (Booking Flow)

**What works well:**
- "Getting started" progress tracker (1 of 4 complete) is excellent onboarding UX
- Step icons with completion states (✓ vs grayed out) are clear
- Calendar with "Available — tap to book" / "Unavailable" legend is intuitive
- Clean top nav bar (Book, My Bookings, My Pet) with user avatar

**Issues to address:**

- **"β Private Beta" badge** — Decide if you want clients seeing this. It could reduce confidence in the platform. If it's for internal tracking, hide it behind a setting.
- **"Guest" label in top right** — Even though you're signed in as elyserwilson, it shows "Guest." This is a role-switching artifact but if a real client sees "Guest" they'll think something went wrong. Should show the client's name.
- **Calendar day cells are large and empty** — The "Open" text in each cell is the only content. These cells could show the capacity remaining (e.g., "3 spots left") to help clients plan.
- **Past dates are still visible but grayed out** — They take up space without adding value. Consider starting the calendar view from the current week.
- **No price information** — The booking calendar doesn't show what a stay costs. Clients want to know prices before selecting dates. Adding a small price tag or a "Rates" link would help.

---

## 8. Cross-Cutting Issues

### Mobile Responsiveness
- The app does not appear to have responsive breakpoints for mobile. The admin sidebar is fixed-width and doesn't collapse into a hamburger menu on narrow screens. For Kelly using an iPad, this is probably fine, but phone users (clients booking on mobile) will have issues with the client view.

### Typography Hierarchy
- Font sizes are generally good, but there's inconsistency. Some headers use emoji + bold text, others use plain bold. Standardize: emoji in buttons/badges is fine, but section headers should be text-only with consistent sizing.

### Color Consistency
- Purple/indigo is the primary action color (buttons, links, badges) — good consistency.
- Red is used for both errors AND destructive actions AND overdue status — this overloads the color's meaning. Consider using orange/amber for warnings, red only for errors/destructive.
- Green is used for "vaccines current," "available," and "collected" — appropriate and consistent.

### Empty States
- Most empty states are well-handled ("No bookings today," "No care profile yet," "No guests today"). The "My Pet" page when empty shows nothing at all — just a header and footer. Add a CTA like "Add your first pup to get started!"

### Accessibility
- Color contrast on the light gray "Open" text against white calendar cells is likely below WCAG AA standards.
- The peach/salmon background gradient, while warm, reduces contrast for all text elements slightly.
- No visible focus indicators for keyboard navigation.
- Emoji used as functional indicators (✅ for vaccines, ⚠️ for warnings) should have aria-labels for screen readers.

---

## Top 10 Priority Fixes

1. **Collapse calendar admin controls** into an expandable panel — reclaim viewport space
2. **Hide admin sidebar in kiosk mode** — critical for staff tablet use
3. **Add booking counts to calendar days** — "2/7" on each cell for the admin
4. **Fix the "Collected" stat** — don't show green when nothing is collected
5. **Move "Clear All" button** away from other action buttons, add confirmation
6. **Add mobile responsive breakpoints** — at minimum for the client booking view
7. **Format pet notes properly** — parse structured data instead of showing raw strings
8. **Remove "β Private Beta" badge** from client view before Kelly demo
9. **Add loading timeout/error state** — don't let users stare at spinner indefinitely
10. **Show prices on client booking calendar** — clients need to see cost before booking

---

*This audit reflects the state of the live deployment as of April 6, 2026. Screenshots were captured from the GitHub Pages deployment.*
