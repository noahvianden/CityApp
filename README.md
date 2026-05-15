# Cityprint Prototype

Cityprint is a prototype for gamified local exploration. Users walk through a real city, clear fog around their GPS path, discover selected real-world places, and build progress across cities and districts.

## Product Direction

The current product goal is documented in [product-goal.md](product-goal.md). The near-term focus is the Atlas: live fog reveal, background walk tracking, real place discovery, and city/district completion. Dedicated privacy features are not a current product goal.

The detailed next development plan is documented in [next-development-steps.md](next-development-steps.md). Each item explains what changes, how it works for the user, and how it should work inside the app.

## Current Prototype

- React + TypeScript + Vite web prototype
- Android project generated with Capacitor
- MapLibre atlas with real city boundaries
- Simulated and GPS location modes
- Organic fog-of-war reveal around the active location
- Device-local persistence for revealed fog points and place actions
- Real place discovery from map data through Overpass
- Place cards with save, visited, and memory markers
- Basic Atlas, Walks, Journal, and Progress tabs
- Native Android geolocation, share, clipboard, external browser, and file export integrations

## Run Locally

```bash
npm install
npm run dev
```

The dev server listens on `0.0.0.0`, so you can open it from a phone on the same Wi-Fi using your current machine IP on port `5173`.

On Windows PowerShell, use `cmd /c npm ...` for checks if script execution is blocked.

## Android

The Android shell lives in `android/` and is generated from the current web app through Capacitor.

```bash
npm run android:sync
npm run android:apk
```

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a connected phone with Android Studio, `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`, or:

```bash
npm run android:run
```

Building the APK requires a local JDK and Android SDK. `npm run android:open` opens the project in Android Studio after syncing the latest web build.

## Checks

```bash
npm test
npm run lint
npm run build
```

If PowerShell blocks `npm`, run:

```bash
cmd /c npm test
cmd /c npm run lint
cmd /c npm run build
```
