# AdSpark AI — Social Ad Generator

Turn rough business notes and offer ideas into three ad concepts with captions, ad copy, visual direction, and browser-rendered posters.

Built with React 19, TypeScript, Tailwind CSS, Vite, and server-side Cloudflare Workers AI text generation.

## What AdSpark does

AdSpark turns business and offer details into ready-to-edit social advertising campaigns, including ad concepts, captions, short copy, visual direction, and browser-rendered posters.

## Main features

- Google sign-in and account-based monthly usage limits
- AI-generated campaign copy and visual concepts
- In-browser poster rendering and image export
- Free and paid plans with Razorpay checkout

## Tech stack

React 19, TypeScript, Tailwind CSS, and Vite power the frontend. Cloudflare Workers runs the production API, D1 stores production account and billing records, Workers AI generates campaign content and images, and Razorpay processes payments.

## Quick start

```bash
npm install
```

On Windows, copy the example environment file, fill in the local values you need, then start the development server:

```powershell
Copy-Item .env.example .env
npm run dev
```

The local development server is available at `http://localhost:5173`.

For local AI generation, configure `AI_PROVIDER=ollama` and run Ollama locally. The deployed production site uses Cloudflare Workers AI and does not require Ollama.

## Production URL

<https://adspark-ai.2002saketh.workers.dev>

## Cloudflare deployment

Production is deployed at <https://adspark-ai.2002saketh.workers.dev>. Cloudflare
Workers serves the React/Vite assets and API, D1 stores users, sessions,
generations, billing and payment orders, and the Worker `AI` binding handles
text and image generation. The production D1 schema is applied; local SQLite
remains the development database and is not copied to production. No local PC
or Ollama process is needed while the deployed site is running.

`wrangler.jsonc` contains the public Google client ID, Razorpay live Key ID,
Workers AI model IDs, and the `DB`, `AI`, and `ASSETS` bindings. Razorpay API and
webhook signing secrets are Worker secrets and are not stored in that config.
The deployed Razorpay environment is `live`; local `.env` and the D1 test
configuration remain in `test` mode.

For a new deployment, build the frontend first, then run `npx wrangler deploy`.
Keep `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in Worker secrets. The
Razorpay Live Mode webhook URL is
`https://adspark-ai.2002saketh.workers.dev/api/payments/webhook`; configure its
signing secret to match `RAZORPAY_WEBHOOK_SECRET` and subscribe to
`payment.captured`, `order.paid`, and `payment.failed`. Add the deployed HTTPS
origin to the Google OAuth client's authorized JavaScript origins.

## AI provider configuration

For local development, use `AI_PROVIDER=ollama` and configure `OLLAMA_BASE_URL` and `OLLAMA_MODEL` for an installed local model. Ollama is optional and only used when explicitly selected.

The Node/Vite local API defaults to Ollama only when explicitly selected by
`AI_PROVIDER=ollama`. The deployed Worker uses native Cloudflare bindings and
does not need Ollama, `CLOUDFLARE_ACCOUNT_ID`, or `CLOUDFLARE_API_TOKEN`.
Configure `CLOUDFLARE_AI_MODEL` and `CLOUDFLARE_IMAGE_MODEL` as Worker vars:

```env
CLOUDFLARE_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8-fast
CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell
```

The older Node API's Cloudflare REST adapter still exists for environments that
explicitly select it. Its account/token credentials are not used by the
production Worker and must never be added to frontend Vite variables.

Cloudflare uses the [Workers AI chat completions endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) and [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/). The default model is `@cf/meta/llama-3.1-8b-instruct-fp8-fast`.

The production poster flow also uses Cloudflare Workers AI text-to-image through the backend only. `CLOUDFLARE_IMAGE_MODEL` defaults to `@cf/black-forest-labs/flux-1-schnell`. Each campaign's three concept images are generated as part of the existing single ad allowance reservation. Image bytes are held in browser memory for the current campaign and are not stored in SQLite. Uploaded user photos take priority and skip generated imagery. If image generation is unavailable, the campaign completes with the existing poster layout and marks the concept `TEMPLATE_FALLBACK`.

## Ad generation and posters

The server keeps the existing AdSpark prompts, verifies structured campaign fields, and returns the same campaign shape. The browser canvas renderer uses the generated concept and design direction; its layout and styling are unchanged.

## Google sign-in setup

Authentication uses Google Identity Services (GIS) to return a signed ID token. The AdSpark backend verifies that token against `GOOGLE_CLIENT_ID`, identifies the account by Google's stable `sub`, and creates an HTTP-only application session. It requests identity/profile information only; it does not request Gmail access.

### Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. In **Google Auth Platform**, configure **Branding** and **Audience**. For an external app in testing mode, add the Google accounts that may sign in as test users. Configure only the basic identity scopes; no Gmail API or Gmail scopes are needed.
3. Open **Clients** and create an OAuth client with application type **Web application**.
4. Add `http://localhost` and `http://localhost:5173` under **Authorized JavaScript origins**. This app uses the GIS popup callback, so no redirect URI is used.
5. Copy the Web client ID into `GOOGLE_CLIENT_ID` in `.env`. Do not put a client secret in the frontend; this implementation does not use one.

Set `APP_ORIGIN=http://localhost:5173` in `.env`, then restart `npm run dev`. The auth database is created at `.local/adspark-auth.sqlite` by default. It stores Google identities keyed by `sub`, revocable sessions, and generation-to-user associations. The SQLite file must be on persistent storage for accounts and sessions to survive server restarts; this small single-server store is not intended for multi-instance or serverless deployment.

When a production domain is selected, add its exact HTTPS origin to the Web OAuth client's **Authorized JavaScript origins** and set `APP_ORIGIN` to that origin. Use persistent server storage for `AUTH_DB_PATH`, terminate HTTPS at the deployment host, and run with `NODE_ENV=production` so session cookies are marked Secure. No production domain or redirect URI is assumed here.

## Pricing and Razorpay test mode

Pricing is configured on the server in `server/auth.js`. The app displays INR or USD prices from `/api/billing/plans`; payment amounts are calculated server-side. A paid checkout grants one billing period beginning at the verified payment time. Plans do not auto-renew; customers purchase again after the period ends.

Set these values in `.env` (the example file contains blank placeholders):

```env
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_signing_secret
RAZORPAY_ENVIRONMENT=test
```

The API secret and webhook signing secret are used only on the server. The browser receives only the public Key ID. Local development remains in test mode; the deployed Worker uses live keys. The app rejects keys whose prefix does not match the configured environment.

### Razorpay Dashboard setup

1. In the [Razorpay Dashboard](https://dashboard.razorpay.com/), select **Test Mode**, then find the API keys under **Account & Settings > API Keys**. Add the test Key ID and Key Secret to `.env`.
2. Restart `npm run dev`. Start checkout from the app; the backend creates an order with the plan price and amount in the currency's smallest unit. The browser callback alone cannot activate a plan: the server verifies its signature and confirms the captured payment and paid order with Razorpay.
3. For payment status updates, add a webhook at **Account & Settings > Webhooks** pointing to `https://<public-host>/api/payments/webhook`. Local webhooks need a secure public tunnel to the running server. Create a webhook signing secret in Razorpay and set the same value as `RAZORPAY_WEBHOOK_SECRET` in `.env`; it is separate from the API Key Secret. Subscribe to `payment.captured`, `order.paid`, and `payment.failed`.
4. USD pricing is separately configured, not an exchange conversion. International payments and USD must be enabled on the Razorpay account; if they are not, USD checkout returns a clear unavailable message. INR checkout remains available.
5. Production runs on Cloudflare Workers. Set `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` with `npx wrangler secret put`; keep the public live Key ID and `RAZORPAY_ENVIRONMENT=live` in Worker vars. Do not put live secret values in source files or `wrangler.jsonc`.

See Razorpay's [Create Order API](https://razorpay.com/docs/api/orders/create/?preferred-country=IN), [Standard Checkout integration](https://razorpay.com/docs/server-integration/python/test-app/), [webhook setup](https://razorpay.com/docs/payments/payments/dashboard//?preferred-country=IN), and [security checklist](https://razorpay.com/security/checklist/).
