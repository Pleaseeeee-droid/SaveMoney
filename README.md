# SaveMoney

A mobile-first installable web app for date-locked savings goals.

## What works now

- Create multiple savings vaults
- Set a savings goal
- Choose a future unlock date
- Add deposits to a vault
- Block withdrawals until the unlock date
- Show funding progress and unlock countdowns
- Export a JSON backup
- Install as a PWA on supported phones/desktops
- Works offline after the first load

> Important: the current balance is demo/local data stored in the browser. No real money is held or moved yet.

## Run it locally

Because the project uses a service worker, serve it over HTTP instead of opening `index.html` directly.

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Fastest public deployment: GitHub Pages

In the GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. Save.

GitHub will provide the public HTTPS URL. Once opened on Android/Chrome, use **Add to Home screen / Install app** to install it like an app.

## Real-money architecture

Do **not** collect or store raw debit-card numbers in this frontend.

A production version needs:

1. **Secure account linking** through a provider-hosted flow such as Plaid Link or a comparable regulated provider.
2. **Backend API** for all transfer requests and secrets.
3. **Money movement / custody partner** that can actually hold funds or maintain a ledger balance.
4. **Server-side lock enforcement**. The server must reject every withdrawal before `unlock_at`; hiding a button in the UI is not enough.
5. **Authentication**, encrypted secrets, audit logs, transfer/webhook reconciliation, and idempotency.
6. **Identity/compliance requirements** required by the provider for the chosen product.

### Required lock rule

Conceptually, every withdrawal endpoint should enforce this before any provider call:

```text
if current_time < vault.unlock_at:
    reject withdrawal
else:
    allow eligible withdrawal
```

The frontend should never receive an override capability that can move `unlock_at` earlier. If an unlock date is changed at all, it should only be allowed to move later.

## Suggested next phase

- Add sign-in and a hosted database
- Add a backend
- Integrate provider sandbox account linking
- Add real transfer records and webhooks
- Enforce immutable unlock dates server-side
- Test with sandbox money
- Only then enable production money movement

## Turning it into an APK

Once the hosted PWA is stable, it can be packaged for Android (for example with Trusted Web Activity tooling or Capacitor) without rewriting the user interface.
