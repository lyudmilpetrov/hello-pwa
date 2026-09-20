# Receipt API

A standalone, dependency-free Node.js 24+ service for the receipt frontend on GitHub Pages. It fetches receipt JSON from the fixed `tax.salyk.kg` endpoint and returns it with the configured CORS headers. It does not store receipts or accept image uploads.

For Cloudflare Workers, the Node HTTP adapter and account configuration are included. Run `npm run dev:worker` in this directory to test on port 8787, `npm run check:worker` to check the bundle, and `npm run deploy:worker` to publish. Follow the [Cloudflare deployment guide](CLOUDFLARE_DEPLOYMENT.md) for CORS checks and GitHub Pages setup.

## Run locally

From the repository root, `npm run dev` starts both Vite and this API by default. Open `http://127.0.0.1:5173`; Vite forwards receipt requests to `http://127.0.0.1:3001`. Stop both processes with Ctrl+C. `npm run preview` also starts this API alongside the built frontend. When `RECEIPT_API_PROXY_TARGET` is set, the frontend runner skips this API and forwards requests to that service instead; see [local development with the deployed Worker](CLOUDFLARE_DEPLOYMENT.md#use-the-deployed-worker-from-localhost).

To run only the API from the repository root, using the standalone backend settings without the frontend runner's local overrides:

```sh
npm run dev:api
```

This directory is also a complete Node app that can run without the frontend:

```sh
cd backend
npm start
```

Use `npm run dev` inside this directory to restart the API when its sources change. No dependency installation or compilation is needed. The standalone scripts read an optional `.env` in this directory; copy `.env.example` when configuring local settings. Environment variables supplied by the host take precedence.

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Network interface to listen on. |
| `PORT` | `3001` | API port; Azure supplies this value. |
| `RECEIPT_ALLOWED_ORIGINS` | None | Comma-separated frontend origins, such as `https://lyudmilpetrov.github.io`. Use origins without paths. |
| `BASE_PATH` | `/` | Optional prefix for the API routes. Use `/` for the separate Azure app. |

The root development and preview commands bind the API to `127.0.0.1` with `BASE_PATH=/`. No local CORS setting is needed because Vite proxies receipt requests. They read `PORT` from `backend/.env`; set `API_PORT` in the root `.env.local` to override that port and update the Vite proxy together. A `VITE_RECEIPT_API_BASE_URL` in the root `.env.local` makes the frontend call that remote API instead.

`GET /health` provides a basic service health response without contacting the tax website. `POST /api/receipts` accepts JSON with a `url` property containing a tax receipt URL. The root `/` does not serve a website.

Receipt links may contain any subset of the supported parameters: `date`, `sum`, `fn_number`, `regNumber`, `tin`, `type`, `operation_type`, `fd_number`, and `fm`. Only supplied parameters are forwarded; the tax service determines whether they identify a receipt. Supplied values are still validated, and duplicate or unsupported parameters are rejected. Receipt details are read from the tax service's JSON response.

## Package for Azure App Service

Run this in PowerShell from the repository root:

```powershell
./scripts/package-receipt-api.ps1
```

Deploy `artifacts/receipt-api/receipt-api.zip`. Its root contains `package.json`, `README.md`, `src/index.ts`, and `src/receiptApi.ts`. The script packages only these files and excludes environment files, credentials, photos, saved receipts, frontend assets, and `node_modules`.

In your chosen Azure subscription, create a **Linux** App Service using a **Node 24 LTS** runtime and the **F1 Free** plan. Enable HTTPS and set the startup command to `npm start`. These runtime and plan options are described in the [Azure Node quickstart](https://learn.microsoft.com/en-us/azure/app-service/quickstart-nodejs).

Set these App Service environment variables:

```text
HOST=0.0.0.0
BASE_PATH=/
RECEIPT_ALLOWED_ORIGINS=https://lyudmilpetrov.github.io
SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

Leave `PORT` to Azure. This package needs no remote build or npm dependency installation because Node 24 runs the TypeScript sources directly. See [Azure Node configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs).

For an **existing** Linux App Service, the following optional Azure CLI commands configure and deploy the package. Replace the three placeholders with your intended subscription, resource group, and app before running them from the repository root. Every Azure command explicitly selects the subscription.

```powershell
$apiSubscription = '<YOUR-SUBSCRIPTION-ID>'
$apiResourceGroup = '<YOUR-RESOURCE-GROUP>'
$apiAppName = '<YOUR-APP-NAME>'

az webapp config set --subscription $apiSubscription --resource-group $apiResourceGroup --name $apiAppName --linux-fx-version 'NODE|24-lts' --startup-file 'npm start'
az webapp update --subscription $apiSubscription --resource-group $apiResourceGroup --name $apiAppName --https-only true
az webapp config appsettings set --subscription $apiSubscription --resource-group $apiResourceGroup --name $apiAppName --settings 'HOST=0.0.0.0' 'BASE_PATH=/' 'RECEIPT_ALLOWED_ORIGINS=https://lyudmilpetrov.github.io' 'SCM_DO_BUILD_DURING_DEPLOYMENT=false'
az webapp deploy --subscription $apiSubscription --resource-group $apiResourceGroup --name $apiAppName --src-path './artifacts/receipt-api/receipt-api.zip' --type zip
```

The deployment command follows the [Azure CLI webapp reference](https://learn.microsoft.com/en-us/cli/azure/webapp#az-webapp-deploy). It deploys to the existing app; it does not choose a subscription or create a hosting plan for you.

## Connect GitHub Pages

1. Open `https://<YOUR-APP-HOSTNAME>/health` and verify the API responds. Copy the actual default domain from Azure rather than guessing its hostname.
2. In GitHub repository **Settings → Secrets and variables → Actions → Variables**, set `RECEIPT_API_BASE_URL` to `https://<YOUR-APP-HOSTNAME>/`, without `api/receipts`.
3. Rerun **Actions → Deploy to GitHub Pages**. This value is embedded at build time, so saving the variable alone does not update the published frontend.
4. Reload the published app and import a receipt. The browser console's `[Receipt import]` messages help diagnose the request and response.

For testing the deployed API from your local frontend, set `RECEIPT_API_PROXY_TARGET` to its HTTPS base URL in the root `.env.development.local` and leave `VITE_RECEIPT_API_BASE_URL` empty. Restart `npm run dev`. Vite forwards imports to the deployed API without starting the local Node API, and no localhost CORS entry is needed. A direct browser call using `VITE_RECEIPT_API_BASE_URL` instead requires the actual localhost origin in the deployed service's `RECEIPT_ALLOWED_ORIGINS`.
