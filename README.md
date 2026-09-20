# Hello PWA

A receipt collector built with React, TypeScript, Redux Toolkit, Tailwind CSS, and Vite. Scan a Kyrgyz tax receipt QR code with **Take an image**, select one or more receipt images with **Upload files**, or paste a receipt link to import its details into the table.

Camera scans and uploaded images use the same import process: decode the QR link, fetch the receipt through the app's receipt API, extract its fields, and save it to the table and Redux store without leaving the app. The camera stops as soon as a link is detected. If fetching fails, the detected link stays in the input so **Import receipt** can retry without another scan. **View receipt** opens the original receipt website when needed.

Multiple selected images are processed one at a time, with the current filename and progress shown while each receipt is read and imported. A failed image does not stop the remaining files. The final summary counts successful and failed files, and failures are listed by filename with original receipt links when available. The first failed receipt link stays in the input for retry. You can select the same files again; reimporting a receipt updates its existing row.

On a phone, the scanner requests a detailed rear-camera feed and uses continuous autofocus when the device exposes it. Flashlight and zoom controls appear only on cameras that support them. **Take a photo instead** requests the phone's rear-camera photo interface and reads the resulting full-resolution image locally; the exact camera/picker interface depends on the mobile browser. This is useful for dense or blurry printed codes. The browser cannot invoke the proprietary QR scanner inside the phone's Camera app.

The table shows the receipt date, Чек №, merchant, total amount, VAT (НДС), ИНН, ККМ, ФМ, ФПД, ФД, and expandable purchased items. Чек № comes from the receipt API's `ticketNumber` field. Amounts are stored as integer minor units; dates display as DD.MM.YYYY using the Bishkek calendar date, without the time, and fiscal identifiers retain their leading zeros. Redux keeps the imported receipts, with versioned localStorage persistence for refresh/offline viewing. Reimporting the same receipt updates its row. Previously saved receipts remain available; reimport them to fill in Чек №.

Use **Download Excel** beside the receipt count to export all saved receipts as an `.xlsx` workbook. The Receipts sheet includes the displayed fields, address, source links, and receipt IDs; Purchased items includes every item linked to its receipt. Both sheets include Чек № and dates formatted as DD.MM.YYYY without time. Amounts are numeric values in сом, dates use the Bishkek calendar date, and fiscal identifiers remain text to preserve leading zeros. Missing VAT and receipt numbers stay blank. Export runs locally and also works offline after the production app has been cached.

## Develop

Use Node.js 24 or newer.

```sh
npm install
npm run dev
```

## Build and preview

```sh
npm run build
npm run preview
```

The tax receipt endpoint returns JSON and does not allow cross-origin browser requests. The app uses its own `POST /api/receipts` endpoint to retrieve that JSON. Vite development and preview servers include this endpoint. Images stay in the browser; only the decoded receipt link is sent to the app server, which fetches the fixed `tax.salyk.kg` receipt endpoint.

For a production deployment with both the app and its receipt API, build and run the included Node server:

```sh
npm run build
npm start
```

It listens on `127.0.0.1:3000` by default. Configure `HOST`, `PORT`, and `BASE_PATH` for your host. Use the same `BASE_PATH` at build and runtime, for example `/hello-pwa/`. Put the Node server behind HTTPS for public use; when a reverse proxy terminates HTTPS, include the public app origin in `RECEIPT_ALLOWED_ORIGINS`.

The service worker is enabled in production builds. Open the app once online, let it activate, and then reload offline to view previously imported receipts. New receipt imports need an internet connection. Supported browsers can install the app using their install or Add to Home Screen action.

## Automatic GitHub Pages deployment

Live site: https://lyudmilpetrov.github.io/hello-pwa/

GitHub Pages serves only the frontend; it cannot run the receipt API. To enable receipt imports there, host the included Node server over HTTPS, set its `RECEIPT_ALLOWED_ORIGINS` to `https://lyudmilpetrov.github.io`, and set the repository Actions variable `RECEIPT_API_BASE_URL` to that server's base URL. The workflow passes this value to `VITE_RECEIPT_API_BASE_URL` during the frontend build. The base URL must end at the app root, without `api/receipts` (for example `https://receipts.example.com/`). Local development needs no such setting.

If a QR link is detected but importing fails on the phone, check the browser's `/api/receipts` request before changing the scanner. A GitHub Pages HTML 404/405 means the receipt backend is missing. The tax website can open in a separate tab while blocking direct JavaScript access from another origin, so opening the URL with the phone's Camera app does not verify the import API. The PWA preserves the decoded link and offers **Open original receipt** when importing fails. Configure the backend URL and rebuild the frontend to enable automatic importing; an HTTPS backend with the allowed Pages origin is required. The app does not send receipt links to public CORS proxies.

The `.github/workflows/deploy-pages.yml` workflow builds and publishes the site on every push to `master`. It can also be started manually from the repository's **Actions → Deploy to GitHub Pages → Run workflow** menu. In **Settings → Pages**, the publishing source must be **GitHub Actions**.

Commit and push your changes to publish an update:

```sh
git add <changed-files>
git commit -m "Describe your change"
git push origin master
```

Only committed changes pushed to GitHub trigger deployment. Local file saves do not publish. Follow the workflow in the repository's Actions tab to see when the update is live.

The workflow installs locked dependencies with `npm ci`, builds using Node.js 24, and uploads only `dist`. GitHub supplies the deployment token automatically; no personal access token or repository secret is needed. The Pages configuration supplies `BASE_PATH` so assets, the manifest, and the service worker use `/hello-pwa/`. Local development defaults to `/`.

To check the Pages path locally in PowerShell:

```powershell
$env:BASE_PATH = '/hello-pwa/'
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm test
Remove-Item Env:BASE_PATH
```

Workflow setup follows the [Vite GitHub Pages guide](https://vite.dev/guide/static-deploy#github-pages).

## Customize

- `src/App.tsx`: image actions, receipt link input, import progress/errors, and receipt table integration.
- `src/components/ReceiptTable.tsx`: semantic receipt and purchased-item tables, with horizontal scrolling on small screens and links to original receipts.
- `src/lib/receiptData.ts`: validates and normalizes the tax service response. VAT comes only from VAT counters; sales tax is separate, and missing VAT remains unknown rather than being replaced with zero.
- `src/store/`: typed Redux store, duplicate-safe receipt updates, and validated localStorage persistence under `taxes.receipts.v1`.
- `server/`: receipt JSON retrieval and production static server. Receipt requests accept only the fixed tax receipt host/path and its known parameters, with bounded sizes/timeouts and no redirects.
- `src/components/CameraScanner.tsx`: mobile camera dialog with a detailed rear-camera stream, optional focus/light/zoom controls, and native photo-capture fallback. It continuously scans using multiple detail levels and the native BarcodeDetector where available alongside bundled ZXing, stops the camera, and passes the decoded link to the shared receipt importer. Cancel/Escape, backgrounding, failure, and page exit release camera tracks; permission failures support retry. Camera access requires HTTPS or localhost.
- `src/lib/receiptBarcode.ts`: local QR decoding and website URL validation. Images are processed in the browser without uploading them to a server. When a photo contains two QR codes, the scanner uses the bottom code for the fiscal receipt. If that code cannot be read or does not contain an HTTP or HTTPS website link, it shows an error instead of opening the promotional code above it.
- `src/styles.css`: Tailwind import, dark variant, and global styles.
- `vite.config.ts`: PWA name, metadata, icons, and caching.
- `public/`: favicon and installation icons.

The theme follows the operating system preference and respects any previously saved local theme choice. The head script applies the theme before React renders to prevent a theme flash. No remote fonts or assets are required.

## Verify

```sh
npx playwright install chromium
npm test
```

Tests cover JSON normalization, the restricted receipt API, Redux updates/persistence, all displayed fields, purchased items, retry behavior, duplicate imports, mobile layout, themes, and offline viewing. Camera checks feed `samples/qr/PXL_20260920_120718550.jpg` through real video frames at several resolutions when that local sample is present. Generated QR cases always run. Tests also cover native-detector fallback, photo capture, focus/light/zoom controls, and unavailable import services. They use mocked hardware capabilities and receipt API responses; no automated test contacts the live tax service. Physical Android/iPhone testing is still needed to verify each device's camera controls and photo-picker behavior.

Tests also discover photos directly inside `samples/`. Some supplied photos remain unreadable by the QR decoder, so those sample checks report the specific failures. To run the deterministic application suite independently of the local photo corpus:

```sh
npm test -- --grep-invert "local receipt sample"
```

To use an existing Edge installation instead of downloading Chromium, run this in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm test
```
