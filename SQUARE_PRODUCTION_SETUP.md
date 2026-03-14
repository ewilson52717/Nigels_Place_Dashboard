# Square Production Setup — Nigel's Place PawDesk

This guide walks you through switching from Square Sandbox to Production so real payments can be processed.

## Prerequisites

- A Square account at [squareup.com](https://squareup.com)
- Admin access to the PawDesk dashboard
- The Google Sheet "Nigel's Place - Live Data" must be accessible

## Step 1: Get Your Production Credentials

1. Go to [developer.squareup.com/apps](https://developer.squareup.com/apps)
2. Select your app (or create one if you haven't yet — name it "Nigel's Place PawDesk")
3. In the left sidebar, click **Production**
4. Copy the **Access Token** (starts with `EAAA...`)
5. Find your **Location ID**:
   - Go to **Locations** in the Square Developer dashboard, or
   - In your Square Dashboard at [squareup.com/dashboard](https://squareup.com/dashboard), go to **Account & Settings → Business → Locations** — the Location ID is shown for each location

## Step 2: Update PawDesk Settings

1. Sign in to PawDesk as admin (elyserwilson@gmail.com or kellyhendrickson1@yahoo.com)
2. Go to **Settings** in the left sidebar
3. Scroll to the **Square API Integration** section
4. Paste your **Production Access Token** into the "Square Access Token" field
5. Paste your **Production Location ID** into the "Square Location ID" field
6. **Uncheck** the "Sandbox mode" checkbox — the indicator should change from "🧪 Sandbox mode" to "🟢 Production mode"
7. Click **Save Settings**

## Step 3: Update the Apps Script Proxy

The proxy also reads Square credentials from the Settings sheet. Since you updated Settings in Step 2, the proxy will automatically use the new production credentials. No code changes needed.

To verify the proxy is using production:
1. Open the Google Sheet
2. Go to the **Settings** tab
3. Confirm these rows exist with the correct values:
   - `squareApiKey` → your production access token (EAAA...)
   - `squareLocationId` → your production location ID
   - `squareSandbox` → `false`

## Step 4: Test with a Real Payment

1. As admin, switch to client view or sign in as a test client
2. Book a daycare session (cheapest option)
3. When the "Pay Now" overlay appears, click it
4. Complete the Square checkout with a real card
5. Verify the charge appears in your [Square Dashboard → Transactions](https://squareup.com/dashboard/sales/transactions)
6. Refund the test transaction from the Square Dashboard if needed

## Step 5: Verify Checkout Links Work

After switching to production, existing checkout links (from sandbox) will no longer work. Any bookings made during sandbox testing will show broken payment links. To fix this:

- Cancel and rebook any sandbox-era bookings, OR
- Manually clear the `checkoutUrl` column in the Bookings sheet for those rows

## Important Notes

- **Never share your Production Access Token publicly** — it's stored in the Settings sheet (private) and in browser localStorage for admin only
- The proxy routes all client payment requests server-side, so the access token is never exposed to client browsers
- Square sandbox and production use different base URLs:
  - Sandbox: `connect.squareupsandbox.com`
  - Production: `connect.squareup.com`
- If something goes wrong, re-check the "Sandbox mode" checkbox in Settings to switch back

## Rollback

To switch back to sandbox at any time:
1. Settings → Square API Integration → check "Sandbox mode"
2. Replace the access token with your sandbox token (from developer.squareup.com → Sandbox)
3. Save Settings
