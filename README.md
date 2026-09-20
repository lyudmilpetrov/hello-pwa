# Hello PWA

A minimal React + TypeScript + Tailwind CSS application built with Vite.

## Develop

Use Node.js 22.12+ (or a newer supported release).

```sh
npm install
npm run dev
```

## Build and preview

```sh
npm run build
npm run preview
```

Deploy the `dist` directory to any static host over HTTPS. The service worker is enabled in production builds; use the preview server on localhost to check offline behavior. Open the app once online, let the service worker activate, and then reload offline. Supported browsers can install it using their install or Add to Home Screen action.

## Automatic GitHub Pages deployment

Live site: https://lyudmilpetrov.github.io/hello-pwa/

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

- `src/App.tsx`: centered action bar with camera and upload icons. Each button logs its label to the browser console.
- `src/styles.css`: Tailwind import, dark variant, and global styles.
- `vite.config.ts`: PWA name, metadata, icons, and caching.
- `public/`: favicon and installation icons.

The theme follows the operating system preference and respects any previously saved local theme choice. The head script applies the theme before React renders to prevent a theme flash. No remote fonts or assets are required.

## Verify

```sh
npx playwright install chromium
npm test
```

The browser checks cover persisted themes, a narrow mobile viewport, the manifest and icons, and an offline reload of the production build.

To use an existing Edge installation instead of downloading Chromium, run this in PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm test
```
