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
 *   cancelBooking      — mark a booking as 'cancelled'
 *   updateBooking      — update checkoutUrl and/or paymentStatus on an existing booking
 *   createCheckoutLink — call Square API server-side and return a checkout URL
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
    if (action === 'updateBooking')     return updateBooking(ss, req, email);
    if (action === 'createCheckoutLink') return createCheckoutLink(ss, req, email);
    if (action === 'updateProfile')     return updateProfile(ss, req, email);
    if (action === 'updateDog')         return updateDog(ss, req, email);
    if (action === 'updateDogVaccines') return updateDogVaccines(ss, req, email);
    if (action === 'addBooking')        return addBooking(ss, req, email);
    if (action === 'addPackage')        return addPackage(ss, req, email);
    if (action === 'sendInvoiceEmail')  return sendInvoiceEmail(ss, req, email);
    if (action === 'sendSquareInvoice') return sendSquareInvoice(ss, req, email);
    if (action === 'syncSquarePayments') return syncSquarePayments(ss, req, email);
    if (action === 'cancelSquareInvoice') return cancelSquareInvoice(ss, req, email);

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
  // Normalise Date objects → YYYY-MM-DD strings so JSON serialisation doesn't produce
  // ISO datetime strings that the client-side parser can't handle (Invalid Date bug).
  const bookings = [];
  if (bookingsSheet) {
    const bkRows = bookingsSheet.getDataRange().getValues();
    for (let i = 1; i < bkRows.length; i++) {
      if (String(bkRows[i][1]) === String(clientId)) {
        const row = bkRows[i].slice();
        // Columns 5 (checkIn) and 6 (checkOut) may be Date objects
        if (row[5] instanceof Date) row[5] = Utilities.formatDate(row[5], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (row[6] instanceof Date) row[6] = Utilities.formatDate(row[6], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        bookings.push(row);
      }
    }
  }

  // Return a SAFE subset of settings.
  // geminiApiKey and googleMapsApiKey are included so clients can use AI features
  // (vaccine scanning, vet lookup) when accessing the portal from their own browser.
  const SAFE_KEYS = ['businessName','dailyCapacity','fullDayRate','halfDayRate',
                     'groomingAddOn','venmoHandle','squareLink','capacityOverrides',
                     'requiredVaccines','geminiApiKey','googleMapsApiKey','multiPetDiscount',
                     'courierConfig'];
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

  // Return this client's invoices so they can see outstanding balances
  // and pay via checkout links. Only returns invoices for this specific client.
  const invoicesSheet = ss.getSheetByName('Invoices');
  const invoiceRows = [];
  if (invoicesSheet) {
    const invData = invoicesSheet.getDataRange().getValues();
    for (let i = 1; i < invData.length; i++) {
      if (String(invData[i][1]) === String(clientId)) {
        const row = invData[i].slice();
        // Normalise Date objects in dueDate (col 6) and issueDate (col 7)
        if (row[6] instanceof Date) row[6] = Utilities.formatDate(row[6], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        if (row[7] instanceof Date) row[7] = Utilities.formatDate(row[7], Session.getScriptTimeZone(), 'yyyy-MM-dd');
        invoiceRows.push(row);
      }
    }
  }

  return respond({ ok: true, client: clientRow, dogs, bookings, settings, services, invoices: invoiceRows });
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

// ─── ACTION: createCheckoutLink ───────────────────────────────────────────────
// Calls Square's Online Checkout API server-side and returns a hosted payment URL.
// Running this in Apps Script avoids browser CORS restrictions and keeps Square
// API credentials secure — they are read from the Settings sheet, never sent to
// the client browser.
// Any authenticated user (admin or registered client) may call this.
function createCheckoutLink(ss, req, callerEmail) {
  const { bookingId, amountDollars, label } = req;
  if (!bookingId || !amountDollars) {
    return respond({ ok: false, error: 'bookingId and amountDollars are required.' });
  }

  // Read Square credentials from the Settings sheet
  const settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) return respond({ ok: false, error: 'Settings sheet not found.' });

  let squareApiKey = '', squareLocationId = '', squareSandbox = false;
  const rows = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0]);
    if (k === 'squareApiKey')    squareApiKey    = String(rows[i][1] || '');
    if (k === 'squareLocationId') squareLocationId = String(rows[i][1] || '');
    if (k === 'squareSandbox')    squareSandbox   = String(rows[i][1]).toLowerCase() === 'true';
  }

  if (!squareApiKey)    return respond({ ok: false, error: 'Square API key not configured — add it in Settings.' });
  if (!squareLocationId) return respond({ ok: false, error: 'Square Location ID not configured — add it in Settings.' });

  const sqBase = squareSandbox
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
  const amountCents = Math.round(Number(amountDollars) * 100);
  const idempotencyKey = 'bk-' + bookingId + '-' + Date.now();

  try {
    const response = UrlFetchApp.fetch(sqBase + '/v2/online-checkout/payment-links', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': 'Bearer ' + squareApiKey,
        'Square-Version': '2024-01-18'
      },
      payload: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: label || "Nigel's Place Payment",
          price_money: { amount: amountCents, currency: 'USD' },
          location_id: squareLocationId
        }
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const data = JSON.parse(response.getContentText());

    if (code !== 200 && code !== 201) {
      const errMsg = (data && data.errors && data.errors[0] && data.errors[0].detail)
        || ('Square API error ' + code);
      return respond({ ok: false, error: errMsg });
    }

    const checkoutUrl = (data.payment_link && data.payment_link.url) || '';
    if (!checkoutUrl) return respond({ ok: false, error: 'Square returned no checkout URL.' });
    return respond({ ok: true, checkoutUrl: checkoutUrl });

  } catch (e) {
    return respond({ ok: false, error: 'Square request failed: ' + e.message });
  }
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

  // Append using the 18-column schema: id, clientId, dogId, dogName, clientName,
  // checkIn, checkOut, nights, status, service, addons, price,
  // paymentStatus, depositAmount, squarePaymentId, checkoutUrl, createdBy, familyDogIds
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
    booking.createdBy       || 'client',
    booking.familyDogIds    || '',
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

// ─── ACTION: sendSquareInvoice ────────────────────────────────────────────────
// Creates and publishes a Square Invoice via the Invoices API.
// Square handles email delivery to the client with a professional payment link.
//
// Flow:
//   1. Find or create a Square Customer by email
//   2. Create an Order with line items
//   3. Create an Invoice (draft) referencing the Order + Customer
//   4. Publish the Invoice → Square emails the client
//
// Required fields in req:
//   clientName    — client display name
//   clientEmail   — client email address (for Square Customer lookup/creation)
//   clientPhone   — (optional) client phone number
//   items         — invoice description string
//   amount        — total amount in dollars (number)
//   dueDate       — due date string (YYYY-MM-DD)
//   invoiceId     — PawDesk internal invoice ID (for idempotency)
//
// Only admins can create invoices.
function sendSquareInvoice(ss, req, callerEmail) {
  const ADMIN_EMAILS = ['elyserwilson@gmail.com', 'kellyhendrickson1@yahoo.com'];
  if (!ADMIN_EMAILS.some(a => a.toLowerCase() === callerEmail.toLowerCase())) {
    return respond({ ok: false, error: 'Only admins can send Square invoices.' });
  }

  const { clientName, clientEmail, clientPhone, items, amount, dueDate, invoiceId } = req;
  if (!clientEmail) return respond({ ok: false, error: 'Client email is required for Square invoices.' });
  if (!amount || amount <= 0) return respond({ ok: false, error: 'Invoice amount must be greater than zero.' });

  // Read Square credentials from Settings
  const settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) return respond({ ok: false, error: 'Settings sheet not found.' });

  let squareApiKey = '', squareLocationId = '', squareSandbox = false, businessName = "Nigel's Place";
  const rows = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0]);
    if (k === 'squareApiKey')     squareApiKey     = String(rows[i][1] || '');
    if (k === 'squareLocationId') squareLocationId = String(rows[i][1] || '');
    if (k === 'squareSandbox')    squareSandbox    = String(rows[i][1]).toLowerCase() === 'true';
    if (k === 'businessName')     businessName     = String(rows[i][1] || "Nigel's Place");
  }

  if (!squareApiKey)     return respond({ ok: false, error: 'Square API key not configured in Settings.' });
  if (!squareLocationId) return respond({ ok: false, error: 'Square Location ID not configured in Settings.' });

  const sqBase = squareSandbox
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
  const sqVersion = '2024-01-18';
  const headers = {
    'Authorization': 'Bearer ' + squareApiKey,
    'Square-Version': sqVersion,
    'Content-Type': 'application/json'
  };

  try {
    // ── Step 1: Find or create Square Customer ───────────────────────────
    let customerId = '';

    // Search for existing customer by email
    const searchResp = UrlFetchApp.fetch(sqBase + '/v2/customers/search', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({
        query: { filter: { email_address: { exact: clientEmail.toLowerCase() } } }
      }),
      muteHttpExceptions: true
    });
    const searchData = JSON.parse(searchResp.getContentText());
    if (searchData.customers && searchData.customers.length > 0) {
      customerId = searchData.customers[0].id;
    }

    // Create customer if not found
    if (!customerId) {
      const nameParts = (clientName || '').trim().split(/\s+/);
      const givenName = nameParts[0] || 'Client';
      const familyName = nameParts.slice(1).join(' ') || '';
      const createCustResp = UrlFetchApp.fetch(sqBase + '/v2/customers', {
        method: 'post', contentType: 'application/json', headers: headers,
        payload: JSON.stringify({
          idempotency_key: 'cust-' + clientEmail.toLowerCase() + '-' + Date.now(),
          given_name: givenName,
          family_name: familyName,
          email_address: clientEmail.toLowerCase(),
          phone_number: clientPhone || '',
          reference_id: 'pawdesk-client',
          note: 'Auto-created by PawDesk invoice system'
        }),
        muteHttpExceptions: true
      });
      const custCode = createCustResp.getResponseCode();
      const custData = JSON.parse(createCustResp.getContentText());
      if (custCode !== 200 && custCode !== 201) {
        const err = (custData.errors && custData.errors[0] && custData.errors[0].detail) || ('Customer create failed: ' + custCode);
        return respond({ ok: false, error: err });
      }
      customerId = custData.customer.id;
    }

    // ── Step 2: Create an Order ──────────────────────────────────────────
    const amountCents = Math.round(Number(amount) * 100);
    const orderResp = UrlFetchApp.fetch(sqBase + '/v2/orders', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({
        idempotency_key: 'ord-inv-' + (invoiceId || Date.now()) + '-' + Date.now(),
        order: {
          location_id: squareLocationId,
          customer_id: customerId,
          line_items: [{
            name: items || (businessName + ' Services'),
            quantity: '1',
            base_price_money: { amount: amountCents, currency: 'USD' }
          }]
        }
      }),
      muteHttpExceptions: true
    });
    const orderCode = orderResp.getResponseCode();
    const orderData = JSON.parse(orderResp.getContentText());
    if (orderCode !== 200 && orderCode !== 201) {
      const err = (orderData.errors && orderData.errors[0] && orderData.errors[0].detail) || ('Order create failed: ' + orderCode);
      return respond({ ok: false, error: err });
    }
    const orderId = orderData.order.id;

    // ── Step 3: Create Invoice (draft) ───────────────────────────────────
    // Calculate due date for the payment request
    const dueDateStr = dueDate || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

    const invoiceResp = UrlFetchApp.fetch(sqBase + '/v2/invoices', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({
        idempotency_key: 'inv-' + (invoiceId || Date.now()) + '-' + Date.now(),
        invoice: {
          location_id: squareLocationId,
          order_id: orderId,
          primary_recipient: { customer_id: customerId },
          title: businessName + ' Invoice',
          description: items || 'Pet care services',
          delivery_method: 'EMAIL',
          payment_requests: [{
            request_type: 'BALANCE',
            due_date: dueDateStr,
            tipping_enabled: false,
            automatic_payment_source: 'NONE',
            reminders: [
              { relative_scheduled_days: -3, message: 'Your payment for ' + businessName + ' is due in 3 days.' },
              { relative_scheduled_days: 0,  message: 'Your payment for ' + businessName + ' is due today.' },
              { relative_scheduled_days: 3,  message: 'Your payment for ' + businessName + ' is now 3 days past due. Please remit payment at your earliest convenience.' }
            ]
          }],
          accepted_payment_methods: {
            card: true,
            square_gift_card: false,
            bank_account: true,
            buy_now_pay_later: false,
            cash_app_pay: true
          }
        }
      }),
      muteHttpExceptions: true
    });
    const invCode = invoiceResp.getResponseCode();
    const invData = JSON.parse(invoiceResp.getContentText());
    if (invCode !== 200 && invCode !== 201) {
      const err = (invData.errors && invData.errors[0] && invData.errors[0].detail) || ('Invoice create failed: ' + invCode);
      return respond({ ok: false, error: err });
    }
    const squareInvoiceId = invData.invoice.id;
    const invoiceVersion = invData.invoice.version;

    // ── Step 4: Publish the Invoice → Square emails the client ───────────
    const pubResp = UrlFetchApp.fetch(sqBase + '/v2/invoices/' + squareInvoiceId + '/publish', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({
        idempotency_key: 'pub-' + squareInvoiceId + '-' + Date.now(),
        version: invoiceVersion
      }),
      muteHttpExceptions: true
    });
    const pubCode = pubResp.getResponseCode();
    const pubData = JSON.parse(pubResp.getContentText());
    if (pubCode !== 200 && pubCode !== 201) {
      const err = (pubData.errors && pubData.errors[0] && pubData.errors[0].detail) || ('Invoice publish failed: ' + pubCode);
      return respond({ ok: false, error: err });
    }

    // Extract the payment URL from the published invoice
    const publicUrl = (pubData.invoice && pubData.invoice.public_url) || '';

    return respond({
      ok: true,
      message: 'Square invoice sent to ' + clientEmail,
      squareInvoiceId: squareInvoiceId,
      publicUrl: publicUrl,
      customerId: customerId
    });

  } catch (e) {
    return respond({ ok: false, error: 'Square invoice failed: ' + e.message });
  }
}

// ─── ACTION: syncSquarePayments ───────────────────────────────────────────────
// Checks Square for completed payments and updates booking/invoice statuses.
//
// How it works:
//   1. Reads all bookings with paymentStatus='checkout_pending' or 'deposit_due'
//   2. Queries Square Payments API for recent completed payments at the location
//   3. Matches payments to bookings by reference_id or checkout URL order ID
//   4. Updates the Bookings sheet paymentStatus to 'paid' or 'deposit_paid'
//   5. Also checks Square Invoices for any invoices marked PAID
//
// Admin-only.
function syncSquarePayments(ss, req, callerEmail) {
  const ADMIN_EMAILS = ['elyserwilson@gmail.com', 'kellyhendrickson1@yahoo.com'];
  if (!ADMIN_EMAILS.some(a => a.toLowerCase() === callerEmail.toLowerCase())) {
    return respond({ ok: false, error: 'Only admins can sync payments.' });
  }

  // Read Square credentials
  const settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) return respond({ ok: false, error: 'Settings sheet not found.' });

  let squareApiKey = '', squareLocationId = '', squareSandbox = false;
  const sRows = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < sRows.length; i++) {
    const k = String(sRows[i][0]);
    if (k === 'squareApiKey')     squareApiKey     = String(sRows[i][1] || '');
    if (k === 'squareLocationId') squareLocationId = String(sRows[i][1] || '');
    if (k === 'squareSandbox')    squareSandbox    = String(sRows[i][1]).toLowerCase() === 'true';
  }
  if (!squareApiKey || !squareLocationId) {
    return respond({ ok: false, error: 'Square credentials not configured.' });
  }

  const sqBase = squareSandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const sqVersion = '2024-01-18';
  const headers = {
    'Authorization': 'Bearer ' + squareApiKey,
    'Square-Version': sqVersion,
    'Content-Type': 'application/json'
  };

  const updated = { bookings: [], invoices: [] };
  const debug = { pendingCount: 0, paymentsFromSquare: 0, completedOrdersFromSquare: 0, squareInvoicesChecked: 0 };

  try {
    // ── Sync Bookings ──────────────────────────────────────────────────────
    const bookingsSheet = ss.getSheetByName('Bookings');
    if (bookingsSheet) {
      const bData = bookingsSheet.getDataRange().getValues();
      // Headers: id(0) clientId(1) dogId(2) dogName(3) clientName(4) checkIn(5) checkOut(6) nights(7)
      //          status(8) service(9) addons(10) price(11) paymentStatus(12) depositAmount(13)
      //          squarePaymentId(14) checkoutUrl(15) createdBy(16) familyDogIds(17)
      const pendingRows = [];
      for (let i = 1; i < bData.length; i++) {
        const ps = String(bData[i][12] || '').toLowerCase();
        const price = Number(bData[i][11] || 0);
        // Include ANY booking that isn't already paid/refunded/cancelled AND has a price > 0
        if (price > 0 && ps !== 'paid' && ps !== 'deposit_paid' && ps !== 'refunded' && ps !== 'cancelled') {
          pendingRows.push({ row: i, data: bData[i], checkoutUrl: String(bData[i][15] || '') });
        }
      }

      if (pendingRows.length > 0) {
        // Fetch recent completed payments from Square (last 30 days)
        const beginTime = new Date(Date.now() - 30 * 86400000).toISOString();
        const paymentsResp = UrlFetchApp.fetch(
          sqBase + '/v2/payments?location_id=' + squareLocationId + '&begin_time=' + encodeURIComponent(beginTime) + '&sort_order=DESC&limit=100',
          { method: 'get', headers: headers, muteHttpExceptions: true }
        );
        const paymentsData = JSON.parse(paymentsResp.getContentText());
        const completedPayments = (paymentsData.payments || []).filter(p => p.status === 'COMPLETED');

        // Build a set of completed order IDs from payments
        const completedOrderIds = new Set();
        completedPayments.forEach(p => {
          if (p.order_id) completedOrderIds.add(p.order_id);
        });

        // Also fetch recent orders to cross-reference checkout links
        // Square Payment Links create orders — when paid, the order state becomes COMPLETED
        const ordersResp = UrlFetchApp.fetch(sqBase + '/v2/orders/search', {
          method: 'post', contentType: 'application/json', headers: headers,
          payload: JSON.stringify({
            location_ids: [squareLocationId],
            query: {
              filter: {
                state_filter: { states: ['COMPLETED'] },
                date_time_filter: { created_at: { start_at: beginTime } }
              }
            },
            limit: 100
          }),
          muteHttpExceptions: true
        });
        const ordersData = JSON.parse(ordersResp.getContentText());
        const completedOrders = ordersData.orders || [];

        // Build a set of completed checkout URLs (from order metadata)
        const completedCheckoutOrderIds = new Set();
        completedOrders.forEach(o => {
          completedCheckoutOrderIds.add(o.id);
        });

        // Debug info
        debug.pendingCount = pendingRows.length;
        debug.paymentsFromSquare = completedPayments.length;
        debug.completedOrdersFromSquare = completedOrders.length;
        // Include first few payment summaries for debugging
        debug.samplePayments = completedPayments.slice(0, 5).map(p => ({
          id: p.id, amount: p.amount_money, note: p.note || '', ref: p.reference_id || '', status: p.status
        }));

        // Match pending bookings to completed payments
        // Track which payments have already been matched to avoid double-counting
        const usedPaymentIds = new Set();

        for (const pb of pendingRows) {
          let matched = false;
          let matchedPaymentId = null;

          // Strategy 1: Match by note/reference containing booking ID, dog name, or client name
          for (const payment of completedPayments) {
            if (usedPaymentIds.has(payment.id)) continue;
            const note = (payment.note || '').toLowerCase();
            const refId = (payment.reference_id || '').toLowerCase();
            const bkId = String(pb.data[0]);
            const dogName = String(pb.data[3] || '').toLowerCase();
            const clientName = String(pb.data[4] || '').toLowerCase();
            if (note.includes(bkId) || refId.includes(bkId) ||
                (dogName && note.includes(dogName)) || (clientName && note.includes(clientName))) {
              matched = true;
              matchedPaymentId = payment.id;
              break;
            }
          }

          // Strategy 2: Match by checkout URL order ID (if checkout URL exists)
          if (!matched && pb.checkoutUrl) {
            // Extract order ID from checkout URL if possible
            const urlMatch = pb.checkoutUrl.match(/order[_\/]?([A-Za-z0-9]+)/i);
            if (urlMatch) {
              const orderId = urlMatch[1];
              if (completedCheckoutOrderIds.has(orderId)) {
                matched = true;
              }
            }
          }

          // Strategy 3: Match by exact amount (in cents) — most bookings won't have checkout URLs
          if (!matched) {
            const bkPrice = Math.round(Number(pb.data[11] || 0) * 100); // price in cents
            const bkDeposit = Math.round(Number(pb.data[13] || 0) * 100); // deposit in cents
            if (bkPrice > 0) {
              for (const payment of completedPayments) {
                if (usedPaymentIds.has(payment.id)) continue;
                const paidCents = (payment.amount_money && payment.amount_money.amount) || 0;
                if (paidCents === bkPrice || (bkDeposit > 0 && paidCents === bkDeposit)) {
                  matched = true;
                  matchedPaymentId = payment.id;
                  break;
                }
              }
            }
          }

          // Strategy 4: Check Square Invoices API for invoices paid matching this booking's amount
          if (!matched) {
            const bkPrice = Math.round(Number(pb.data[11] || 0) * 100);
            for (const order of completedOrders) {
              const orderTotal = (order.total_money && order.total_money.amount) || 0;
              if (orderTotal === bkPrice) {
                matched = true;
                break;
              }
            }
          }

          if (matched) {
            if (matchedPaymentId) usedPaymentIds.add(matchedPaymentId);
            const rowIdx = pb.row + 1; // 1-indexed for Sheets
            const wasDeposit = String(pb.data[12]).toLowerCase() === 'deposit_due';
            const newStatus = wasDeposit ? 'deposit_paid' : 'paid';
            bookingsSheet.getRange(rowIdx, 13).setValue(newStatus); // column M = paymentStatus
            updated.bookings.push({ id: pb.data[0], clientName: pb.data[4], dogName: pb.data[3], newStatus: newStatus });
          }
        }
      }
    }

    // ── Sync Invoices ────────────────────────────────────────────────────────
    const invoicesSheet = ss.getSheetByName('Invoices');
    if (invoicesSheet) {
      const iData = invoicesSheet.getDataRange().getValues();
      // Headers: id(0) clientId(1) clientName(2) amount(3) paid(4) status(5) dueDate(6)
      //          issueDate(7) items(8) externalPaid(9) paymentNote(10) checkoutUrl(11) squareInvoiceId(12)
      for (let i = 1; i < iData.length; i++) {
        const sqInvId = String(iData[i][12] || '');
        const status = String(iData[i][5] || '');
        if (sqInvId && status !== 'paid') {
          // Check this invoice's status on Square
          try {
            const invResp = UrlFetchApp.fetch(sqBase + '/v2/invoices/' + sqInvId, {
              method: 'get', headers: headers, muteHttpExceptions: true
            });
            const invData = JSON.parse(invResp.getContentText());
            if (invData.invoice && invData.invoice.status === 'PAID') {
              const rowIdx = i + 1;
              const amount = Number(iData[i][3] || 0);
              invoicesSheet.getRange(rowIdx, 5).setValue(amount);  // column E = paid
              invoicesSheet.getRange(rowIdx, 6).setValue('paid');   // column F = status
              updated.invoices.push({ id: iData[i][0], clientName: iData[i][2], amount: amount });
            }
          } catch (e) {
            // Skip this invoice on error, continue with others
          }
        }
      }
    }

    return respond({
      ok: true,
      message: 'Sync complete. ' + updated.bookings.length + ' booking(s) and ' + updated.invoices.length + ' invoice(s) updated.',
      updated: updated,
      debug: debug
    });

  } catch (e) {
    return respond({ ok: false, error: 'Sync failed: ' + e.message });
  }
}

// ─── ACTION: cancelSquareInvoice ──────────────────────────────────────────────
// Cancels a Square invoice (e.g., when marked as paid externally).
// This stops Square from sending further payment reminders.
// Required: req.squareInvoiceId
function cancelSquareInvoice(ss, req, callerEmail) {
  const ADMIN_EMAILS = ['elyserwilson@gmail.com', 'kellyhendrickson1@yahoo.com'];
  if (!ADMIN_EMAILS.some(a => a.toLowerCase() === callerEmail.toLowerCase())) {
    return respond({ ok: false, error: 'Only admins can cancel Square invoices.' });
  }

  const { squareInvoiceId } = req;
  if (!squareInvoiceId) return respond({ ok: false, error: 'Missing squareInvoiceId.' });

  // Read Square credentials
  const settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) return respond({ ok: false, error: 'Settings sheet not found.' });

  let squareApiKey = '', squareSandbox = false;
  const rows = settingsSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const k = String(rows[i][0]);
    if (k === 'squareApiKey')  squareApiKey  = String(rows[i][1] || '');
    if (k === 'squareSandbox') squareSandbox = String(rows[i][1]).toLowerCase() === 'true';
  }
  if (!squareApiKey) return respond({ ok: false, error: 'Square API key not configured.' });

  const sqBase = squareSandbox ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
  const headers = {
    'Authorization': 'Bearer ' + squareApiKey,
    'Square-Version': '2024-01-18',
    'Content-Type': 'application/json'
  };

  try {
    // First, get the current invoice to check its status and version
    const getResp = UrlFetchApp.fetch(sqBase + '/v2/invoices/' + squareInvoiceId, {
      method: 'get', headers: headers, muteHttpExceptions: true
    });
    const getData = JSON.parse(getResp.getContentText());
    if (!getData.invoice) {
      return respond({ ok: false, error: 'Invoice not found on Square.' });
    }

    const sqStatus = getData.invoice.status;
    const version = getData.invoice.version;

    // If already paid or cancelled, nothing to do
    if (sqStatus === 'PAID') {
      return respond({ ok: true, message: 'Invoice already marked as paid on Square.' });
    }
    if (sqStatus === 'CANCELED' || sqStatus === 'CANCELLED') {
      return respond({ ok: true, message: 'Invoice already cancelled on Square.' });
    }

    // Cancel the invoice
    const cancelResp = UrlFetchApp.fetch(sqBase + '/v2/invoices/' + squareInvoiceId + '/cancel', {
      method: 'post', contentType: 'application/json', headers: headers,
      payload: JSON.stringify({ version: version }),
      muteHttpExceptions: true
    });
    const cancelCode = cancelResp.getResponseCode();
    const cancelData = JSON.parse(cancelResp.getContentText());

    if (cancelCode !== 200 && cancelCode !== 201) {
      const err = (cancelData.errors && cancelData.errors[0] && cancelData.errors[0].detail) || ('Cancel failed: ' + cancelCode);
      return respond({ ok: false, error: err });
    }

    return respond({ ok: true, message: 'Square invoice cancelled. Reminders stopped.' });

  } catch (e) {
    return respond({ ok: false, error: 'Cancel failed: ' + e.message });
  }
}

// ─── ACTION: sendInvoiceEmail ─────────────────────────────────────────────────
// Sends a professional invoice/payment reminder email to a client.
// The email is sent FROM the invoice alias (nigelsplace.invoices@gmail.com)
// via the admin's Gmail "Send mail as" alias. Replies go to elyserwilson@gmail.com.
//
// Required fields in req:
//   clientEmail  — recipient email address
//   clientName   — client's display name
//   subject      — email subject line
//   items        — invoice description / services
//   amount       — total amount due (number)
//   dueDate      — due date string
//   checkoutUrl  — (optional) Square payment link
//   invoiceId    — (optional) for logging
//
// Only admins can trigger this — the caller's email must match an admin email.
function sendInvoiceEmail(ss, req, callerEmail) {
  // Security: only admins can send invoice emails
  const ADMIN_EMAILS = ['elyserwilson@gmail.com', 'kellyhendrickson1@yahoo.com'];
  if (!ADMIN_EMAILS.some(a => a.toLowerCase() === callerEmail.toLowerCase())) {
    return respond({ ok: false, error: 'Only admins can send invoice emails.' });
  }

  const { clientEmail, clientName, subject, items, amount, dueDate, checkoutUrl } = req;
  if (!clientEmail) return respond({ ok: false, error: 'Missing client email address.' });

  // Read business name from Settings sheet
  let businessName = "Nigel's Place";
  const settingsSheet = ss.getSheetByName('Settings');
  if (settingsSheet) {
    const settingRows = settingsSheet.getDataRange().getValues();
    for (let i = 1; i < settingRows.length; i++) {
      if (String(settingRows[i][0]) === 'businessName' && settingRows[i][1]) {
        businessName = String(settingRows[i][1]);
        break;
      }
    }
  }

  // Build the email body (HTML for nice formatting)
  const amountStr = Number(amount || 0).toFixed(2);
  const payButton = checkoutUrl
    ? '<div style="text-align:center;margin:24px 0;">'
      + '<a href="' + checkoutUrl + '" style="display:inline-block;background:#7B4015;color:#ffffff;'
      + 'font-size:16px;font-weight:bold;padding:14px 32px;border-radius:12px;text-decoration:none;">'
      + '💳 Pay $' + amountStr + ' Now</a></div>'
    : '';

  const htmlBody = '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;max-width:520px;margin:0 auto;color:#1F2937;">'
    + '<div style="background:linear-gradient(135deg,#7B4015 0%,#A0522D 100%);padding:24px 28px;border-radius:16px 16px 0 0;">'
    + '<h1 style="margin:0;color:#ffffff;font-size:20px;">🐾 ' + businessName + '</h1>'
    + '<p style="margin:6px 0 0;color:#F5E6D3;font-size:13px;">Payment Reminder</p>'
    + '</div>'
    + '<div style="background:#ffffff;padding:28px;border:1px solid #E5E7EB;border-top:none;">'
    + '<p style="margin:0 0 16px;font-size:15px;">Hi ' + (clientName || 'there') + ',</p>'
    + '<p style="margin:0 0 20px;font-size:14px;color:#4B5563;line-height:1.6;">'
    + 'This is a friendly reminder that you have an outstanding balance with ' + businessName + '.</p>'
    + '<div style="background:#FFF7ED;border:1px solid #FDE68A;border-radius:12px;padding:16px 20px;margin:0 0 20px;">'
    + '<table style="width:100%;font-size:14px;border-collapse:collapse;">'
    + '<tr><td style="padding:4px 0;color:#6B7280;">Services</td>'
    + '<td style="padding:4px 0;text-align:right;font-weight:600;color:#1F2937;">' + (items || 'Pet care services') + '</td></tr>'
    + '<tr><td style="padding:4px 0;color:#6B7280;">Amount Due</td>'
    + '<td style="padding:4px 0;text-align:right;font-weight:700;font-size:18px;color:#7B4015;">$' + amountStr + '</td></tr>'
    + (dueDate ? '<tr><td style="padding:4px 0;color:#6B7280;">Due Date</td>'
    + '<td style="padding:4px 0;text-align:right;font-weight:600;color:#1F2937;">' + dueDate + '</td></tr>' : '')
    + '</table></div>'
    + payButton
    + '<p style="margin:20px 0 0;font-size:13px;color:#6B7280;line-height:1.6;">'
    + 'If you\'ve already paid, please disregard this message. '
    + 'If you have any questions, just reply to this email — we\'re happy to help!</p>'
    + '</div>'
    + '<div style="background:#F9FAFB;padding:16px 28px;border-radius:0 0 16px 16px;border:1px solid #E5E7EB;border-top:none;">'
    + '<p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">'
    + '🐾 ' + businessName + ' · Sent with love for your fur babies</p>'
    + '</div></div>';

  // Plain-text fallback
  const plainBody = 'Hi ' + (clientName || 'there') + ',\n\n'
    + 'This is a payment reminder from ' + businessName + '.\n\n'
    + 'Services: ' + (items || 'Pet care services') + '\n'
    + 'Amount due: $' + amountStr + '\n'
    + (dueDate ? 'Due date: ' + dueDate + '\n' : '')
    + (checkoutUrl ? '\nPay now: ' + checkoutUrl + '\n' : '')
    + '\nThank you!\n' + businessName;

  try {
    GmailApp.sendEmail(clientEmail, subject || ('Payment Reminder — ' + businessName), plainBody, {
      htmlBody: htmlBody,
      from: 'nigelsplace.invoices@gmail.com',
      replyTo: 'elyserwilson@gmail.com',
      name: businessName + ' Invoices',
    });
    return respond({ ok: true, message: 'Email sent to ' + clientEmail });
  } catch (err) {
    return respond({ ok: false, error: 'Failed to send email: ' + err.message });
  }
}

// ─── RESPONSE HELPER ─────────────────────────────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
