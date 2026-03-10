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
 *   4. If valid, it writes the client/dog/booking row to the sheet
 *   5. The sheet stays 100% private — no one sees it but admins
 *
 * SUPPORTED ACTIONS
 * ─────────────────
 *   registerClient  — add a new client + dog row (onboarding step 3)
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
 *       https://docs.google.com/spreadsheets/d/  ← YOUR_ID_HERE  ←  /edit
 *   • Paste it into the SHEET_ID constant below (replace the placeholder)
 *
 * STEP 4 — Save the script
 *   • Press Ctrl+S (or Cmd+S on Mac)
 *
 * STEP 5 — Deploy as Web App
 *   • Click "Deploy" → "New deployment"
 *   • Click the gear icon ⚙️ next to "Select type" → choose "Web app"
 *   • Fill in:
 *       Description:   Nigel's Place Client Proxy v1
 *       Execute as:    Me  (this is critical — it runs with your permissions)
 *       Who can access: Anyone
 *   • Click "Deploy"
 *   • If prompted, click "Authorize access" and sign in with your Google account
 *     (the same account that owns the sheet — elyserwilson@gmail.com)
 *   • Google will show a warning "This app isn't verified" — click "Advanced"
 *     then "Go to NigelsPlace_ClientProxy (unsafe)" — this is fine because
 *     YOU wrote the code and YOU are authorizing it
 *   • Click "Allow"
 *   • Copy the Web App URL that appears (looks like:
 *       https://script.google.com/macros/s/AKfycb.../exec )
 *
 * STEP 6 — Paste the URL into PawDesk Settings
 *   • Open the dashboard → Settings → "Client Portal Proxy"
 *   • Paste the Web App URL into the "Apps Script Web App URL" field
 *   • Click "Save Settings"
 *
 * STEP 7 — Test it
 *   • Open a private/incognito browser window
 *   • Go to the dashboard and sign in with a non-admin Google account
 *   • Complete the onboarding wizard → click "Create My Profile"
 *   • Should succeed with no 403 error
 *   • Check your Google Sheet — you should see the new client row appear
 *
 * UPDATING THE SCRIPT LATER
 *   If you ever change this script, re-deploy:
 *   Deploy → Manage deployments → edit the existing deployment → "New version"
 *   The URL stays the same after an update — no need to change Settings.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Paste your Google Sheet ID here (the long string from the sheet's URL)
const SHEET_ID = 'PASTE_YOUR_SHEET_ID_HERE';

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────
function doPost(e) {
  try {
    // Parse the incoming JSON body
    const req = JSON.parse(e.postData.contents);
    const { action, token } = req;

    if (!action) return respond({ ok: false, error: 'Missing action' });
    if (!token)  return respond({ ok: false, error: 'Missing token — not signed in?' });

    // Verify the Google OAuth token and get the caller's email
    const email = verifyToken(token);
    if (!email) return respond({ ok: false, error: 'Invalid or expired Google token. Please sign in again.' });

    // Open the sheet
    const ss = SpreadsheetApp.openById(SHEET_ID);

    // Route to the correct handler
    if (action === 'registerClient') return registerClient(ss, req, email);
    if (action === 'updateVetLimit')  return updateVetLimit(ss, req, email);
    if (action === 'cancelBooking')   return cancelBooking(ss, req, email);

    return respond({ ok: false, error: `Unknown action: ${action}` });

  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

// ─── TOKEN VERIFICATION ───────────────────────────────────────────────────────
// Calls Google's userinfo endpoint to confirm the token is valid.
// Returns the verified email address, or null if invalid.
function verifyToken(token) {
  try {
    const r = UrlFetchApp.fetch(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true,
      }
    );
    if (r.getResponseCode() !== 200) return null;
    const info = JSON.parse(r.getContentText());
    return info.email || null;
  } catch (e) {
    return null;
  }
}

// ─── ACTION: registerClient ───────────────────────────────────────────────────
// Appends a new row to the Clients sheet and a new row to the Dogs sheet.
// Payload: { client: { id, name, email, phone, photoConsent }, dog: { id, clientId, name, breed, age, notes, emergencyVetLimit } }
function registerClient(ss, req, callerEmail) {
  const { client, dog } = req;

  // Safety check: token email must match the client email being registered
  if (client.email.toLowerCase() !== callerEmail.toLowerCase()) {
    return respond({ ok: false, error: 'Email mismatch — cannot register a profile for a different user.' });
  }

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');

  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });
  if (!dogsSheet)    return respond({ ok: false, error: 'Dogs sheet not found' });

  // Append client row: id, name, email, phone, photoConsent
  clientsSheet.appendRow([
    client.id,
    client.name,
    client.email,
    client.phone,
    client.photoConsent ? 'TRUE' : 'FALSE',
  ]);

  // Append dog row (all 16 columns matching Dogs!A1:P1 schema)
  // id, clientId, name, breed, age, vaccinated, notes, birthday, vaccExpiry,
  // vaccines, driveFileLink, photoLink, playPhotos, photoOffset, emergencyVetLimit, deceased
  dogsSheet.appendRow([
    dog.id,
    dog.clientId,
    dog.name,
    dog.breed || 'Mixed Breed',
    dog.age || 0,
    'FALSE',            // vaccinated — admin verifies in person
    dog.notes || '',
    '',                 // birthday
    '',                 // vaccExpiry
    '[]',              // vaccines (JSON array)
    '',                 // driveFileLink
    '',                 // photoLink
    '[]',              // playPhotos (JSON array)
    '{"x":50,"y":50}', // photoOffset
    dog.emergencyVetLimit || '',
    'FALSE',            // deceased
  ]);

  return respond({ ok: true, message: 'Client registered successfully.' });
}

// ─── ACTION: updateVetLimit ───────────────────────────────────────────────────
// Finds a dog row by dogId and updates column O (emergencyVetLimit, index 15).
// Payload: { dogId, vetLimit }
// Security: only the dog's owner (matched by email in Clients sheet) can update.
function updateVetLimit(ss, req, callerEmail) {
  const { dogId, vetLimit } = req;

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');

  if (!clientsSheet || !dogsSheet) return respond({ ok: false, error: 'Sheet not found' });

  // Find the caller's client ID
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  // Find the dog row
  const dogRows = dogsSheet.getDataRange().getValues();
  for (let i = 1; i < dogRows.length; i++) {
    if (String(dogRows[i][0]) === String(dogId)) {
      // Verify ownership
      if (String(dogRows[i][1]) !== callerClientId) {
        return respond({ ok: false, error: 'Permission denied — this dog does not belong to your account.' });
      }
      // Column O = index 14 (0-based), sheet column 15 (1-based)
      dogsSheet.getRange(i + 1, 15).setValue(vetLimit || '');
      return respond({ ok: true, message: 'Vet limit updated.' });
    }
  }
  return respond({ ok: false, error: 'Dog not found.' });
}

// ─── ACTION: cancelBooking ────────────────────────────────────────────────────
// Finds a booking row by bookingId and sets column I (status, index 8) to 'cancelled'.
// Payload: { bookingId }
// Security: only the booking's owner (matched by clientId → email in Clients) can cancel.
function cancelBooking(ss, req, callerEmail) {
  const { bookingId } = req;

  const clientsSheet  = ss.getSheetByName('Clients');
  const bookingsSheet = ss.getSheetByName('Bookings');

  if (!clientsSheet || !bookingsSheet) return respond({ ok: false, error: 'Sheet not found' });

  // Find caller's client ID
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  // Find the booking row
  const bookingRows = bookingsSheet.getDataRange().getValues();
  for (let i = 1; i < bookingRows.length; i++) {
    if (String(bookingRows[i][0]) === String(bookingId)) {
      // Verify ownership
      if (String(bookingRows[i][1]) !== callerClientId) {
        return respond({ ok: false, error: 'Permission denied — this booking does not belong to your account.' });
      }
      // Column I = index 8 (0-based), sheet column 9 (1-based)
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
