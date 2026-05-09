# Cityprint Prototype

Cityprint is a prototype for personal city exploration. Users reveal map areas by moving through a city, discover places only inside revealed areas, and save private memories.

## Product Goal

The full product goal is documented in [docs/product-goal.md](docs/product-goal.md). It explains the core loop, the privacy stance, and what the software is intentionally not.

## Current Prototype

- React + TypeScript + Vite web prototype
- Android project generated with Capacitor
- Simulated city selection
- Fog-of-war atlas with simulated walk reveal
- Privacy-aware route trace that stays hidden by default
- Device-local persistence that keeps precise GPS coordinates transient
- Place visibility gated by revealed cells
- Memory creation and journal
- District stats and privacy controls
- Device-local persistence for selected city, revealed cells, saved places, memories, route progress, and privacy settings
- Privacy export preview and local data reset controls
- Native Android geolocation, share, clipboard, external browser, and file export integrations

## Run Locally

```bash
npm install
npm run dev
```

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

## Product Notes

The reveal model is documented in [docs/reveal-model.md](docs/reveal-model.md). It defines the next technical step before real GPS or map-provider integration.

## Checks

```bash
npm run lint
npm run build
```

If PowerShell blocks `npm`, run:

```bash
cmd /c npm test
cmd /c npm run lint
cmd /c npm run build
```
