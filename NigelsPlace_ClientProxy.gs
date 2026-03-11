/**
 * NigelsPlace_ClientProxy.gs
 * ──────────────────────────────────────────────────────────────────────────────
 * Google Apps Script — Client Write Proxy for Nigel's Place PawDesk
 *
 * PURPOSE
 * ───────
 * New clients sign in with their own Google account, which has no access to
 * Elyse's private Google Sheet. This script runs *as Elyse* (the sheet owner)
 * and acts as a secure middleman:
 *   1. A client hits "Create My Profile" in the dashboard
 *   2. The dashboard POSTs their data + their Google OAuth token to this script
 *   3. This script verifies the token against Google's userinfo endpoint
 *   4. If valid, it reads/writes the sheet on their behalf
 *   5. The sheet stays 100% private — no one sees it but admins
 *
 * SUPPORTED ACTIONS
 * ─────────────────
 *   registerClient  — add a new client + dog row (onboarding step 3)
 *                     IDs are assigned server-side to avoid collisions
 *   getClientData   — return client's own record, dogs, bookings + safe settings
 *   updateVetLimit  — update a dog's emergency vet spending limit
 *   cancelBooking   — mark a booking as 'cancelled'
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *  SETUP INSTRUCTIONS — follow these steps in order
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * STEP 1 — Open Google Apps Script
 *   • Go to https://script.google.com
 *   • Click "New project"
 *   • Name it "NigelsPlace_ClientProxy" (top-left, click "Untitled project")
 *
 * STEP 2 — Paste this code
 *   • Delete everything in the editor
 *   • Paste this entire file
 *
 * STEP 3 — Set your Sheet ID
 *   • Open your Google Sheet (the Nigel's Place backend sheet)
 *   • Copy the long ID from the URL:
 *       https://docs.google.com/spreadsheets/d/  ← YOUR_ID_HERE ←  /edit
 *   • Paste it into the SHEET_ID constant below (replace the placeholder)
 *
 * STEP 4 — Save the script (Ctrl+S / Cmd+S)
 *
 * STEP 5 — Deploy as Web App
 *   • Click "Deploy" → "New deployment"
 *   • Click the gear icon ⚙️ next to "Select type" → choose "Web app"
 *   • Fill in:
 *       Description:   Nigel's Place Client Proxy v2
 *       Execute as:    Me  (critical — runs with your permissions)
 *       Who can access: Anyone
 *   • Click "Deploy"
 *   • Authorize access if prompted (sign in as elyserwilson@gmail.com)
 *   • Copy the Web App URL (https://script.google.com/macros/s/AKfycb.../exec)
 *
 * STEP 6 — Paste the URL into PawDesk
 *   • Open dashboard → Settings → "Client Portal Proxy"
 *   • Paste the URL into the "Apps Script Web App URL" field → Save Settings
 *   • Also paste it into CONFIG.APPS_SCRIPT_URL near the top of happypaws-dashboard.html
 *
 * UPDATING THE SCRIPT LATER
 *   Deploy → Manage deployments → edit existing → "New version"
 *   The URL stays the same — no need to update Settings.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const SHEET_ID = '1hQEJB1tFOAk8RoQTyH2Ovkk56psVIJfLjuvlj_URTeg';

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const { action, token } = req;

    if (!action) return respond({ ok: false, error: 'Missing action' });
    if (!token)  return respond({ ok: false, error: 'Missing token — not signed in?' });

    const email = verifyToken(token);
    if (!email) return respond({ ok: false, error: 'Invalid or expired Google token. Please sign in again.' });

    const ss = SpreadsheetApp.openById(SHEET_ID);

    if (action === 'registerClient') return registerClient(ss, req, email);
    if (action === 'getClientData')  return getClientData(ss, req, email);
    if (action === 'updateVetLimit') return updateVetLimit(ss, req, email);
    if (action === 'cancelBooking')  return cancelBooking(ss, req, email);

    return respond({ ok: false, error: `Unknown action: ${action}` });

  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

// ─── TOKEN VERIFICATION ───────────────────────────────────────────────────────
function verifyToken(token) {
  try {
    const r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (r.getResponseCode() !== 200) return null;
    const info = JSON.parse(r.getContentText());
    return info.email || null;
  } catch (e) {
    return null;
  }
}

// ─── ACTION: registerClient ───────────────────────────────────────────────────
// Appends a new client + dog row. IDs are assigned HERE (server-side) to avoid
// collisions — the client-supplied id values in the payload are ignored.
// Returns { ok, clientId, dogId } so the browser can update its local state.
function registerClient(ss, req, callerEmail) {
  const { client, dog } = req;

  if (client.email.toLowerCase() !== callerEmail.toLowerCase()) {
    return respond({ ok: false, error: 'Email mismatch — cannot register a profile for a different user.' });
  }

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');
  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });
  if (!dogsSheet)    return respond({ ok: false, error: 'Dogs sheet not found' });

  // ── Assign IDs server-side ─────────────────────────────────────────────────
  // Read the current max client ID so we can safely increment it.
  const clientData = clientsSheet.getDataRange().getValues();
  let maxClientId = 0;
  for (let i = 1; i < clientData.length; i++) {
    const id = parseInt(clientData[i][0]) || 0;
    if (id > maxClientId) maxClientId = id;
  }
  const newClientId = maxClientId + 1;

  const dogData = dogsSheet.getDataRange().getValues();
  let maxDogId = 0;
  for (let i = 1; i < dogData.length; i++) {
    const id = parseInt(dogData[i][0]) || 0;
    if (id > maxDogId) maxDogId = id;
  }
  const newDogId = maxDogId + 1;
  // ──────────────────────────────────────────────────────────────────────────

  clientsSheet.appendRow([
    newClientId,
    client.name,
    client.email,
    client.phone,
    client.photoConsent ? 'TRUE' : 'FALSE',
  ]);

  dogsSheet.appendRow([
    newDogId,
    newClientId,          // always use server-assigned clientId
    dog.name,
    dog.breed || 'Mixed Breed',
    dog.age || 0,
    'FALSE',              // vaccinated — admin verifies in person
    dog.notes || '',
    '',                   // birthday
    '',                   // vaccExpiry
    '[]',                 // vaccines (JSON array)
    '',                   // driveFileLink
    '',                   // photoLink
    '[]',                 // playPhotos (JSON array)
    '{"x":50,"y":50}',    // photoOffset
    dog.emergencyVetLimit || '',
    'FALSE',              // deceased
  ]);

  // Return the server-assigned IDs so the browser can sync local state
  return respond({ ok: true, message: 'Client registered successfully.', clientId: newClientId, dogId: newDogId });
}

// ─── ACTION: getClientData ────────────────────────────────────────────────────
// Returns the verified caller's own client record, dogs, bookings, and a safe
// subset of settings (no API keys). Called by the client portal on sign-in and
// on every refresh — this is how clients read their own data without needing
// direct access to the private Google Sheet.
function getClientData(ss, req, callerEmail) {
  const clientsSheet  = ss.getSheetByName('Clients');
  const dogsSheet     = ss.getSheetByName('Dogs');
  const bookingsSheet = ss.getSheetByName('Bookings');
  const settingsSheet = ss.getSheetByName('Settings');

  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });

  // Find the caller's client record by email
  const clientRows = clientsSheet.getDataRange().getValues();
  let clientId = null, clientRow = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      clientId = clientRows[i][0];
      clientRow = clientRows[i];
      break;
    }
  }
  if (!clientId) return respond({ ok: false, error: 'No client record found for this email. You may need to complete registration first.' });

  // Get this client's dogs
  const dogs = [];
  if (dogsSheet) {
    const dogRows = dogsSheet.getDataRange().getValues();
    for (let i = 1; i < dogRows.length; i++) {
      if (String(dogRows[i][1]) === String(clientId)) {
        dogs.push(dogRows[i]);
      }
    }
  }

  // Get this client's bookings
  const bookings = [];
  if (bookingsSheet) {
    const bkRows = bookingsSheet.getDataRange().getValues();
    for (let i = 1; i < bkRows.length; i++) {
      if (String(bkRows[i][1]) === String(clientId)) {
        bookings.push(bkRows[i]);
      }
    }
  }

  // Return a SAFE subset of settings — never return API keys, passwords, etc.
  const SAFE_KEYS = ['businessName','dailyCapacity','fullDayRate','halfDayRate',
                     'groomingAddOn','venmoHandle','squareLink','capacityOverrides',
                     'requiredVaccines'];
  const settings = {};
  if (settingsSheet) {
    const settingRows = settingsSheet.getDataRange().getValues();
    for (let i = 1; i < settingRows.length; i++) {
      const k = String(settingRows[i][0]), v = settingRows[i][1];
      if (SAFE_KEYS.includes(k)) settings[k] = v;
    }
  }

  return respond({ ok: true, client: clientRow, dogs, bookings, settings });
}

// ─── ACTION: updateVetLimit ───────────────────────────────────────────────────
function updateVetLimit(ss, req, callerEmail) {
  const { dogId, vetLimit } = req;

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');
  if (!clientsSheet || !dogsSheet) return respond({ ok: false, error: 'Sheet not found' });

  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  const dogRows = dogsSheet.getDataRange().getValues();
  for (let i = 1; i < dogRows.length; i++) {
    if (String(dogRows[i][0]) === String(dogId)) {
      if (String(dogRows[i][1]) !== callerClientId) {
        return respond({ ok: false, error: 'Permission denied — this dog does not belong to your account.' });
      }
      dogsSheet.getRange(i + 1, 15).setValue(vetLimit || '');
      return respond({ ok: true, message: 'Vet limit updated.' });
    }
  }
  return respond({ ok: false, error: 'Dog not found.' });
}

// ─── ACTION: cancelBooking ────────────────────────────────────────────────────
function cancelBooking(ss, req, callerEmail) {
  const { bookingId } = req;

  const clientsSheet  = ss.getSheetByName('Clients');
  const bookingsSheet = ss.getSheetByName('Bookings');
  if (!clientsSheet || !bookingsSheet) return respond({ ok: false, error: 'Sheet not found' });

  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  const bookingRows = bookingsSheet.getDataRange().getValues();
  for (let i = 1; i < bookingRows.length; i++) {
    if (String(bookingRows[i][0]) === String(bookingId)) {
      if (String(bookingRows[i][1]) !== callerClientId) {
        return respond({ ok: false, error: 'Permission denied — this booking does not belong to your account.' });
      }
      bookingsSheet.getRange(i + 1, 9).setValue('cancelled');
      return respond({ ok: true, message: 'Booking cancelled.' });
    }
  }
  return respond({ ok: false, error: 'Booking not found.' });
}

// ─── RESPONSE HELPER ─────────────────────────────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
