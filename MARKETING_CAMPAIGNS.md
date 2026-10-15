# BEST ELECTRICAL — Customers & Campaigns

This feature is added on `feature/bulk-offers-consent`. It adds a consent-first contact registry and a campaign dashboard. It does not silently scrape contacts in the browser.

## Owner workflow

1. For the initial low-cost option, export contacts from the owner's Android Contacts app to a VCF file and import it here. CSV with `Name` and `Phone`/ `Mobile` headers is also supported.
2. For a true one-tap on-device contact sync, install the separate owner-only utility in `best-electrical-mobile/owner-contact-sync`. Customers do not install this utility.
3. Import only contacts the shop is permitted to manage. Contact import does **not** mean marketing consent; new customer records default to SMS and WhatsApp opted out.
4. Record SMS and WhatsApp consent independently only after actual customer opt-in. Withdraw the relevant channel when consent is withdrawn.
5. Create a campaign, preview eligible recipients, save a draft and explicitly queue it. A customer who opted into both channels may receive one message on each if both are selected.

## Deployment

- Build the admin panel for Vercel using `npm run build`.
- Configure `VITE_API_URL` as the backend API base URL, including `/api`, for example `https://YOUR-BACKEND-HOST/api`.
- Configure `ADMIN_API_KEY` on the backend host. Use a randomly generated secret of at least 24 characters. Enter that same key in the campaign panel when needed. Do not put the key in a `VITE_*` variable or commit it to Git.
- Backend marketing endpoints require `x-admin-key` and a working MongoDB connection.
- Keep SMS/WhatsApp provider keys only in backend environment variables.

## Messaging configuration

See the backend repository's `MARKETING_CAMPAIGNS.md` and `.env.example` for adapter variables. Provider adapters are not automatically configured by this UI. The SMS adapter is a generic gateway contract which may need mapping to the selected provider. WhatsApp Business requires a valid WhatsApp Business Platform setup and approved template.

Do not queue live promotional campaigns until applicable Indian DLT registrations/headers/templates/consent requirements and WhatsApp opt-in/template conditions are complete. Provider acceptance is not proof of device delivery; provider-specific delivery webhooks and opt-out handling must be wired before treating reports as production-grade.

## Security limitation

This branch protects only the new `/api/admin/marketing` API with `ADMIN_API_KEY`. Existing product, offers, greetings, review moderation and enquiry admin APIs are still separate and should be placed behind production admin authentication before deployment. Use HTTPS for all real requests.
