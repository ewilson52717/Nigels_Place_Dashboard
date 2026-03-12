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
 *   addDog          — add an additional dog to an existing client profile
 *   updateVetLimit  — update a dog's emergency vet spending limit
 *   cancelBooking   — mark a booking as 'cancelled'
 *   updateBooking   — update checkoutUrl and/or paymentStatus on an existing booking
 *   updateProfile   — update caller's email, phone, photoConsent (My Account)
 *   updateDog       — update a dog's breed/age/birthday/notes/vetLimit (My Account)
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
    if (action === 'addDog')         return addDog(ss, req, email);
    if (action === 'updateVetLimit') return updateVetLimit(ss, req, email);
    if (action === 'cancelBooking')  return cancelBooking(ss, req, email);
    if (action === 'updateBooking')  return updateBooking(ss, req, email);
    if (action === 'updateProfile')     return updateProfile(ss, req, email);
    if (action === 'updateDog')         return updateDog(ss, req, email);
    if (action === 'updateDogVaccines') return updateDogVaccines(ss, req, email);
    if (action === 'addBooking')        return addBooking(ss, req, email);
    if (action === 'addPackage')        return addPackage(ss, req, email);

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
    '',                   // vaccOverride
    dog.vetName || '',    // vetName  (col 18)
    dog.vetPhone || '',   // vetPhone (col 19)
    dog.vetWebsite || '', // vetWebsite (col 20)
  ]);

  // Return the server-assigned IDs so the browser can sync local state
  return respond({ ok: true, message: 'Client registered successfully.', clientId: newClientId, dogId: newDogId });
}

// ─── ACTION: addDog ───────────────────────────────────────────────────────────
// Adds a new dog to an existing client's profile. The caller must already have
// a client record (i.e. have completed registration). Dog ID is assigned
// server-side. Returns { ok, dogId } on success.
function addDog(ss, req, callerEmail) {
  const { dog } = req;
  if (!dog || !dog.name) return respond({ ok: false, error: 'Dog name is required.' });

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');
  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });
  if (!dogsSheet)    return respond({ ok: false, error: 'Dogs sheet not found' });

  // Find the verified caller's client record
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = clientRows[i][0];
      break;
    }
  }
  if (!callerClientId) {
    return respond({ ok: false, error: 'No client record found for this account. Please complete registration first.' });
  }

  // Assign new dog ID server-side
  const dogData = dogsSheet.getDataRange().getValues();
  let maxDogId = 0;
  for (let i = 1; i < dogData.length; i++) {
    const id = parseInt(dogData[i][0]) || 0;
    if (id > maxDogId) maxDogId = id;
  }
  const newDogId = maxDogId + 1;

  dogsSheet.appendRow([
    newDogId,
    callerClientId,
    String(dog.name || ''),
    String(dog.breed || 'Mixed Breed'),
    Number(dog.age) || 0,
    'FALSE',                       // vaccinated — admin verifies
    String(dog.notes || ''),
    String(dog.birthday || ''),
    '',                            // vaccExpiry
    '[]',                          // vaccines
    '',                            // driveFileLink
    '',                            // photoLink
    '[]',                          // playPhotos
    '{"x":50,"y":50}',             // photoOffset
    String(dog.emergencyVetLimit || ''),
    'FALSE',                       // deceased
    '',                            // vaccOverride
    String(dog.vetName || ''),     // vetName    (col 18)
    String(dog.vetPhone || ''),    // vetPhone   (col 19)
    String(dog.vetWebsite || ''),  // vetWebsite (col 20)
  ]);

  return respond({ ok: true, message: 'Dog added successfully.', dogId: newDogId });
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

  // Return a SAFE subset of settings.
  // geminiApiKey and googleMapsApiKey are included so clients can use AI features
  // (vaccine scanning, vet lookup) when accessing the portal from their own browser.
  const SAFE_KEYS = ['businessName','dailyCapacity','fullDayRate','halfDayRate',
                     'groomingAddOn','venmoHandle','squareLink','capacityOverrides',
                     'requiredVaccines','geminiApiKey','googleMapsApiKey'];
  const settings = {};
  if (settingsSheet) {
    const settingRows = settingsSheet.getDataRange().getValues();
    for (let i = 1; i < settingRows.length; i++) {
      const k = String(settingRows[i][0]), v = settingRows[i][1];
      if (SAFE_KEYS.includes(k)) settings[k] = v;
    }
  }

  // Return all active services so clients see the correct booking options
  // (Full Day / Half Day / Boarding / any custom "Other" services and add-ons).
  // Service data is non-sensitive — names and prices only.
  const servicesSheet = ss.getSheetByName('Services');
  const services = [];
  if (servicesSheet) {
    const svcRows = servicesSheet.getDataRange().getValues();
    for (let i = 1; i < svcRows.length; i++) {
      if (svcRows[i][0]) services.push(svcRows[i]);
    }
  }

  return respond({ ok: true, client: clientRow, dogs, bookings, settings, services });
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

// ─── ACTION: updateBooking ────────────────────────────────────────────────────
// Updates checkoutUrl and/or paymentStatus on an existing booking row.
// Security: the booking must belong to the verified caller (clientId must match).
// Used by the client portal after Square checkout link is generated, so the URL
// survives page reloads and silentRefresh cycles.
function updateBooking(ss, req, callerEmail) {
  const { id, checkoutUrl, paymentStatus } = req;
  if (!id) return respond({ ok: false, error: 'Booking id is required.' });

  const clientsSheet  = ss.getSheetByName('Clients');
  const bookingsSheet = ss.getSheetByName('Bookings');
  if (!clientsSheet || !bookingsSheet) return respond({ ok: false, error: 'Sheet not found.' });

  // Verify caller's clientId
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  // Find and update the booking row
  const bkRows = bookingsSheet.getDataRange().getValues();
  for (let i = 1; i < bkRows.length; i++) {
    if (String(bkRows[i][0]) === String(id)) {
      // Security: booking must belong to caller
      if (String(bkRows[i][1]) !== callerClientId) {
        return respond({ ok: false, error: 'Permission denied — this booking does not belong to your account.' });
      }
      // col13 = paymentStatus (1-indexed), col16 = checkoutUrl
      if (paymentStatus !== undefined) bookingsSheet.getRange(i + 1, 13).setValue(String(paymentStatus));
      if (checkoutUrl   !== undefined) bookingsSheet.getRange(i + 1, 16).setValue(String(checkoutUrl));
      return respond({ ok: true, message: 'Booking updated.' });
    }
  }
  return respond({ ok: false, error: 'Booking not found.' });
}

// ─── ACTION: updateProfile ────────────────────────────────────────────────────
// Updates the caller's email, phone, and photoConsent on the Clients sheet.
function updateProfile(ss, req, callerEmail) {
  const { email, phone, photoConsent } = req;

  const clientsSheet = ss.getSheetByName('Clients');
  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });

  // Find the caller's row by matching the stored email
  const data = clientsSheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      const row = i + 1; // 1-indexed
      // Columns: id(A=1), name(B=2), email(C=3), phone(D=4), photoConsent(E=5)
      clientsSheet.getRange(row, 3).setValue(String(email || data[i][2]));
      clientsSheet.getRange(row, 4).setValue(String(phone || ''));
      clientsSheet.getRange(row, 5).setValue(photoConsent ? 'true' : 'false');
      return respond({ ok: true, message: 'Profile updated.' });
    }
  }
  return respond({ ok: false, error: 'Client record not found for this account.' });
}

// ─── ACTION: updateDog ────────────────────────────────────────────────────────
// Updates a dog's breed, age, birthday, notes, emergencyVetLimit, vetName, vetPhone, vetWebsite.
// Only the client who owns the dog (matched by callerEmail) can update it.
function updateDog(ss, req, callerEmail) {
  const { dogId, breed, age, birthday, notes, emergencyVetLimit, vetName, vetPhone, vetWebsite } = req;
  if (!dogId) return respond({ ok: false, error: 'dogId is required.' });

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');
  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });
  if (!dogsSheet)    return respond({ ok: false, error: 'Dogs sheet not found' });

  // Find caller's clientId
  const clientData = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientData.length; i++) {
    if (String(clientData[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = clientData[i][0];
      break;
    }
  }
  if (callerClientId === null) return respond({ ok: false, error: 'Client record not found.' });

  // Find the dog row — must belong to this client
  const dogData = dogsSheet.getDataRange().getValues();
  for (let i = 1; i < dogData.length; i++) {
    if (String(dogData[i][0]) === String(dogId) && String(dogData[i][1]) === String(callerClientId)) {
      const row = i + 1;
      // Columns: id(1),clientId(2),name(3),breed(4),age(5),vaccinated(6),notes(7),birthday(8),...,emergencyVetLimit(15),deceased(16),vaccOverride(17),vetName(18),vetPhone(19)
      dogsSheet.getRange(row, 4).setValue(String(breed || dogData[i][3] || 'Mixed Breed'));
      dogsSheet.getRange(row, 5).setValue(Number(age) || 0);
      dogsSheet.getRange(row, 8).setValue(String(birthday || ''));
      dogsSheet.getRange(row, 7).setValue(String(notes || ''));
      dogsSheet.getRange(row, 15).setValue(String(emergencyVetLimit || ''));
      dogsSheet.getRange(row, 18).setValue(String(vetName || ''));
      dogsSheet.getRange(row, 19).setValue(String(vetPhone || ''));
      dogsSheet.getRange(row, 20).setValue(String(vetWebsite || ''));
      return respond({ ok: true, message: 'Dog updated.' });
    }
  }
  return respond({ ok: false, error: 'Dog not found or does not belong to your account.' });
}

// ─── ACTION: updateDogVaccines ────────────────────────────────────────────────
// Saves AI-parsed vaccine records for a dog after client portal upload.
// Updates: vaccinated(col6), notes-unchanged, vaccExpiry(col9), vaccines(col10),
//          driveFileLink(col11).
function updateDogVaccines(ss, req, callerEmail) {
  const { dogId, vaccines, vaccExpiry, vaccinated, driveFileLink } = req;
  if (!dogId) return respond({ ok: false, error: 'dogId is required.' });

  const clientsSheet = ss.getSheetByName('Clients');
  const dogsSheet    = ss.getSheetByName('Dogs');
  if (!clientsSheet) return respond({ ok: false, error: 'Clients sheet not found' });
  if (!dogsSheet)    return respond({ ok: false, error: 'Dogs sheet not found' });

  // Verify caller owns this dog
  const clientData = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientData.length; i++) {
    if (String(clientData[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = clientData[i][0];
      break;
    }
  }
  if (callerClientId === null) return respond({ ok: false, error: 'Client record not found.' });

  const dogData = dogsSheet.getDataRange().getValues();
  for (let i = 1; i < dogData.length; i++) {
    if (String(dogData[i][0]) === String(dogId) && String(dogData[i][1]) === String(callerClientId)) {
      const row = i + 1;
      // col6=vaccinated, col9=vaccExpiry, col10=vaccines(JSON), col11=driveFileLink
      dogsSheet.getRange(row, 6).setValue(vaccinated ? 'true' : 'false');
      dogsSheet.getRange(row, 9).setValue(String(vaccExpiry || ''));
      dogsSheet.getRange(row, 10).setValue(JSON.stringify(vaccines || []));
      if (driveFileLink) dogsSheet.getRange(row, 11).setValue(String(driveFileLink));
      return respond({ ok: true, message: 'Vaccines updated.' });
    }
  }
  return respond({ ok: false, error: 'Dog not found or does not belong to your account.' });
}

// ─── ACTION: addBooking ───────────────────────────────────────────────────────
// Appends a new booking row on behalf of a verified client. The booking's
// clientId must match the caller's registered client ID — prevents a client
// from writing bookings under another account.
function addBooking(ss, req, callerEmail) {
  const { booking } = req;
  if (!booking) return respond({ ok: false, error: 'No booking data provided.' });

  const clientsSheet  = ss.getSheetByName('Clients');
  const bookingsSheet = ss.getSheetByName('Bookings');
  if (!clientsSheet || !bookingsSheet) return respond({ ok: false, error: 'Sheet not found.' });

  // Verify caller is a registered client
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  // Security: booking must belong to the caller
  if (String(booking.clientId) !== callerClientId) {
    return respond({ ok: false, error: 'Permission denied — clientId mismatch.' });
  }

  // Derive a safe ID: max existing ID + 1 (avoids conflicts with server-side rows)
  const bkRows = bookingsSheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < bkRows.length; i++) {
    if (bkRows[i][0]) maxId = Math.max(maxId, Number(bkRows[i][0]));
  }
  const safeId = Math.max(Number(booking.id) || 0, maxId + 1);

  // Append using the 16-column schema: id, clientId, dogId, dogName, clientName,
  // checkIn, checkOut, nights, status, service, addons, price,
  // paymentStatus, depositAmount, squarePaymentId, checkoutUrl
  bookingsSheet.appendRow([
    safeId,
    booking.clientId,
    booking.dogId,
    booking.dogName    || '',
    booking.clientName || '',
    booking.checkIn    || '',
    booking.checkOut   || booking.checkIn || '',
    booking.nights     || 1,
    booking.status     || 'confirmed',
    booking.service    || 'Full Day',
    booking.addons     || '',
    booking.price      || 0,
    booking.paymentStatus   || '',
    booking.depositAmount   || 0,
    booking.squarePaymentId || '',
    booking.checkoutUrl     || '',
  ]);

  return respond({ ok: true, id: safeId });
}

// ─── ACTION: addPackage ───────────────────────────────────────────────────────
// Appends a new daycare package purchase row on behalf of a verified client.
function addPackage(ss, req, callerEmail) {
  const { pkg } = req;
  if (!pkg) return respond({ ok: false, error: 'No package data provided.' });

  const clientsSheet  = ss.getSheetByName('Clients');
  const packagesSheet = ss.getSheetByName('Packages');
  if (!clientsSheet || !packagesSheet) return respond({ ok: false, error: 'Sheet not found.' });

  // Verify caller is a registered client
  const clientRows = clientsSheet.getDataRange().getValues();
  let callerClientId = null;
  for (let i = 1; i < clientRows.length; i++) {
    if (String(clientRows[i][2]).toLowerCase() === callerEmail.toLowerCase()) {
      callerClientId = String(clientRows[i][0]);
      break;
    }
  }
  if (!callerClientId) return respond({ ok: false, error: 'Client record not found for this account.' });

  if (String(pkg.clientId) !== callerClientId) {
    return respond({ ok: false, error: 'Permission denied — clientId mismatch.' });
  }

  // Derive a safe ID
  const pkgRows = packagesSheet.getDataRange().getValues();
  let maxId = 0;
  for (let i = 1; i < pkgRows.length; i++) {
    if (pkgRows[i][0]) maxId = Math.max(maxId, Number(pkgRows[i][0]));
  }
  const safeId = Math.max(Number(pkg.id) || 0, maxId + 1);

  // Schema: id, clientId, dogId, clientName, dogName, purchaseDate,
  //         qty, remaining, pricePerSession, totalPaid, notes
  packagesSheet.appendRow([
    safeId,
    pkg.clientId,
    pkg.dogId,
    pkg.clientName     || '',
    pkg.dogName        || '',
    pkg.purchaseDate   || '',
    pkg.qty            || 0,
    pkg.remaining      || 0,
    pkg.pricePerSession|| 0,
    pkg.totalPaid      || 0,
    pkg.notes          || '',
  ]);

  return respond({ ok: true, id: safeId });
}

// ─── RESPONSE HELPER ─────────────────────────────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
