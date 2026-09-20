# Deploy the receipt API to Cloudflare Workers

These steps keep the frontend on GitHub Pages and host the receipt API on Cloudflare Workers. They use the existing Node request handlers through Cloudflare's Node HTTP adapter. The Worker uses this adapter to handle requests; it does not launch this package's `npm start` command like Azure App Service does.

The Worker adapter and account configuration are included. The Worker is deployed at `https://taxes-receipt-api.taxes-kyrgyzstan.workers.dev`. Instructions checked against Cloudflare documentation on 2026-09-20.

## Use the deployed Worker from localhost

The root `.env.development.local` is configured for the deployed Worker. To recreate that local configuration, use:

```dotenv
RECEIPT_API_PROXY_TARGET=https://taxes-receipt-api.taxes-kyrgyzstan.workers.dev
VITE_RECEIPT_API_BASE_URL=
```

Run `npm run dev` from `C:\Work\taxes\hello-pwa`, then open `http://127.0.0.1:5173` or `http://localhost:5173`. Restart the command if it was already running. The terminal prints `Remote receipt API` and the Worker URL. Vite starts alone and forwards `/api/receipts` to Cloudflare. The browser uses the local Vite origin, so the deployed Worker needs no additional CORS origins or redeployment.

Keep `VITE_RECEIPT_API_BASE_URL` empty for this local proxy setup. Setting it to the Worker URL would make the browser call Cloudflare directly and require localhost in the Worker's allowed origins. The development file is ignored by Git and does not affect production builds, preview, or GitHub Actions. Remove the proxy target and restart to use the local Node API again.

## 1. Open the backend directory and install Wrangler

Use Node.js 24 or newer. Create or sign in to your [Cloudflare account](https://dash.cloudflare.com/), using the Workers Free plan for this deployment.

In PowerShell:

```powershell
Set-Location 'C:\Work\taxes\hello-pwa\backend'
node --version
npm install --save-dev wrangler@latest
npx wrangler login
npx wrangler whoami
```

Complete the browser login yourself. If you have multiple Cloudflare accounts, copy the intended account ID from `whoami` for the configuration below. Wrangler is deployment tooling; the receipt API still has no third-party runtime dependencies. See the [Wrangler getting-started guide](https://developers.cloudflare.com/workers/get-started/guide/).

## 2. Add the Worker entry point

The included `backend/cloudflare/worker.mjs` contains:

```javascript
import { httpServerHandler } from 'cloudflare:node'
import { createReceiptServer } from '../src/index.ts'

export default httpServerHandler(createReceiptServer({ basePath: '/' }))
```

This uses the exported server factory, preserving receipt validation, size limits, timeouts, `/health`, and CORS handling. It does not invoke the standalone Node startup or shutdown code. The `.mjs` file is outside `src` so Cloudflare-specific imports do not interfere with the frontend's TypeScript build. Wrangler bundles the imported TypeScript source.

Cloudflare documents `httpServerHandler(server)` as the bridge from a Node HTTP server to Worker requests. It starts the internal listener as needed; no public `PORT` or `HOST` setting is required. See [Node HTTP support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/#nodejs-integration).

## 3. Add the Wrangler configuration

The included `backend/wrangler.jsonc` is configured for the account from your `wrangler whoami` output:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "taxes-receipt-api",
  "account_id": "adc2aa45bd5d8d749ce4878b9e8c2c0a",
  "main": "cloudflare/worker.mjs",
  "compatibility_date": "2026-09-20",
  "workers_dev": true,
  "vars": {
    "BASE_PATH": "/",
    "RECEIPT_ALLOWED_ORIGINS": "https://lyudmilpetrov.github.io"
  }
}
```

Change the account ID if you want to deploy to a different Cloudflare account. Choose another Worker name if the selected account already has a different application named `taxes-receipt-api`.

With this compatibility date, Node compatibility and Node HTTP server support are enabled by default. Use a current Wrangler version so the local runtime understands this date. The existing API reads the configured text variables through `process.env`. See [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) and [process environment support](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/).

`RECEIPT_ALLOWED_ORIGINS` contains the frontend **origin**, without `/hello-pwa/` or a trailing slash. This allows the GitHub Pages frontend to read API responses.

The included `backend/.gitignore` keeps local tooling and environment files out of source control:

```gitignore
node_modules/
.wrangler/
.dev.vars*
.env
.env.*.local
```

Keep `wrangler.jsonc`, the adapter, `package.json`, and the generated `package-lock.json` in source control. The configured origin and account ID are configuration values, not API secrets.

## 4. Test in the local Workers runtime

From the backend directory:

```powershell
npm run dev:worker
```

This package script runs Wrangler on port 8787 with a command-line variable that allows both the Pages origin and `http://127.0.0.1:5173` for this test. It does not change the deployed origin list in `wrangler.jsonc`. Wrangler has its own local environment-file handling, so check the bindings printed on startup if you already have a `backend/.env` or `.dev.vars` file. See [environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/).

Leave that terminal running. In a second PowerShell terminal:

```powershell
$apiBase = 'http://127.0.0.1:8787'
Invoke-RestMethod -Uri "$apiBase/health"

$corsHeaders = @{
    Origin = 'https://lyudmilpetrov.github.io'
    'Access-Control-Request-Method' = 'POST'
    'Access-Control-Request-Headers' = 'content-type'
}
$preflight = Invoke-WebRequest -Uri "$apiBase/api/receipts" -Method Options -Headers $corsHeaders
$preflight.StatusCode
$preflight.Headers['Access-Control-Allow-Origin']
```

Expected results: health reports `status: ok`; the preflight returns `204` and `https://lyudmilpetrov.github.io`.

Test an actual receipt using the plain tax URL copied from its QR code, without Markdown brackets or backslashes:

```powershell
$receiptUrl = '<PASTE_YOUR_FULL_TAX_RECEIPT_URL_HERE>'
$payload = @{ url = $receiptUrl } | ConvertTo-Json -Compress
$receipt = Invoke-RestMethod -Uri "$apiBase/api/receipts" -Method Post -ContentType 'application/json' -Headers @{ Origin = 'https://lyudmilpetrov.github.io' } -Body $payload
$receipt | Select-Object ticketNumber, ticketTotalSum
```

To test from the React app, set this in the repository root's `.env.development.local`:

```dotenv
RECEIPT_API_PROXY_TARGET=http://127.0.0.1:8787
VITE_RECEIPT_API_BASE_URL=
```

Then run `npm run dev` from `C:\Work\taxes\hello-pwa` and import a receipt. Vite forwards imports to the local Wrangler runtime without starting the standalone Node API. Restore the deployed Worker URL to test Cloudflare again, or remove the proxy target to return to the local Node API; restart Vite after changing settings.

## 5. Publish the Worker

After local checks pass, from the backend directory:

```powershell
npm run check:worker
npm run deploy:worker
```

The first command checks bundling without publishing. The second publishes to the account selected in `wrangler.jsonc`. Copy the exact HTTPS URL printed by Wrangler; it will resemble `https://taxes-receipt-api.<YOUR-SUBDOMAIN>.workers.dev`.

Use this Worker deployment flow rather than uploading the Azure ZIP or setting `npm start` as a Cloudflare build command. See [Wrangler deployment](https://developers.cloudflare.com/workers/get-started/guide/#deploy-your-project).

Repeat the health, preflight, and receipt checks from step 4 after changing `$apiBase` to the deployed HTTPS URL. A passing local test does not verify that Cloudflare can reach the tax service; the deployed receipt check does.

## 6. Connect GitHub Pages

In the `lyudmilpetrov/hello-pwa` GitHub repository:

1. Open **Settings → Secrets and variables → Actions → Variables**.
2. Create or update the repository variable `RECEIPT_API_BASE_URL`.
3. Set its value to the Worker HTTPS base URL, for example `https://taxes-receipt-api.<YOUR-SUBDOMAIN>.workers.dev/`. Do not append `/api/receipts`.
4. Open **Actions → Deploy to GitHub Pages → Run workflow** and wait for deployment to finish.
5. Reload the published frontend and import a receipt.

The existing workflow passes that variable to `VITE_RECEIPT_API_BASE_URL` at build time. Updating the variable alone does not change an already published frontend. Open browser DevTools → Console and filter by `[Receipt import]` to confirm the request now targets the Worker.

## 7. Update and troubleshoot

After changing backend source or `wrangler.jsonc`, run `npx wrangler deploy` again from the backend directory. Rebuild GitHub Pages only when its code or configured API URL changes.

Use `npx wrangler tail` from the backend directory while reproducing an error to view Worker logs. See [real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/).

| Result | Check |
| --- | --- |
| Frontend still requests `github.io/hello-pwa/api/receipts` | Verify the GitHub variable, rerun Pages deployment, then reload the app. |
| `403` from the API or a CORS error | Check the actual frontend origin against `RECEIPT_ALLOWED_ORIGINS`; redeploy after editing the configuration. |
| `404` at the Worker root `/` | Expected. Check `/health` and `/api/receipts` instead. |
| `405` when opening `/api/receipts` in a tab | Expected for GET. Import uses POST with a JSON body. |
| `400` from an import | Use the complete plain receipt URL with all query parameters. |
| `502` or `504` from an import | Check Worker logs and tax-service reachability. A health response alone does not check the upstream website. |
| Missing Node modules or no Worker entry point | Verify the compatibility date, update Wrangler, and make sure `main` points to `cloudflare/worker.mjs`. |

The Workers Free plan currently includes 100,000 requests per day and 10 ms of CPU time per request. Waiting for the tax service is excluded from CPU time. Monitor actual usage after deploying; these limits are not a guarantee for every receipt size. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
