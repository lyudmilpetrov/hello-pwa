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

## Customize

- `src/App.tsx`: startup page and theme toggle.
- `src/styles.css`: Tailwind import, dark variant, and global styles.
- `vite.config.ts`: PWA name, metadata, icons, and caching.
- `public/`: favicon and installation icons.

The theme starts from the operating system preference and follows system changes until the user toggles it. Explicit choices persist locally and sync across tabs. The head script applies the theme before React renders to prevent a theme flash. No remote fonts or assets are required.

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
