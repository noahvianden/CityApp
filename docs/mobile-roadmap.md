# Mobile App Roadmap

This branch is dedicated to the mobile version of Cityprint.

## Implemented in this branch

- Added a geo-grid layer that maps real latitude/longitude coordinates into the existing 7 x 8 fog-of-war atlas grid.
- Added city-level geographic bounds for Berlin and Hamburg.
- Updated GPS sample resolution so device GPS is only accepted when it can be mapped into the selected city.
- Changed out-of-city or missing-city GPS samples to return `unmapped` instead of being forced into an arbitrary atlas cell.
- Updated walk-controller GPS behavior to pass the selected city id through the location pipeline.
- Added accuracy-aware GPS reveal behavior:
  - precise GPS samples reveal the current cell plus neighboring cells.
  - coarse-but-accepted GPS samples reveal only the current cell.
  - inaccurate GPS samples are rejected before mapping.
- Replaced grid-only GPS jump rejection with meter-based walking validation.
- Stored the last accepted GPS sample in the walk session so movement speed can be evaluated across real device samples.
- Added mobile GPS diagnostics that summarize sample accuracy, mapped cell, reveal radius, movement speed, and rejection reasons for device testing.
- Added CI for test, lint, web build, Capacitor sync, and Android debug APK build.
- Added unit tests for geo-grid projection, bounds checks, round-tripping cell centers, GPS acceptance, GPS rejection, stale samples, repeated samples, speed-too-fast detection, accuracy-aware reveal radius, and mobile diagnostics.

## Current GPS model

Cityprint still uses the custom fog-of-war atlas UI. The mobile GPS layer now projects real GPS coordinates into this atlas by using each city's geographic bounding box.

This is intentionally simpler than a full map-provider integration. It is good enough for early device testing because it answers the first mobile question:

> Is the user physically inside the selected city, and which atlas cell should this GPS sample reveal?

GPS samples now behave as follows:

- `accuracyM <= 25`: accepted if inside the selected city and reveals the current cell plus neighboring cells.
- `25 < accuracyM <= 50`: accepted if inside the selected city but reveals only the current cell.
- `accuracyM > 50`: rejected as `accuracy-too-low`.
- outside selected city bounds: rejected as `unmapped`.
- stale samples: rejected before they can advance the walk.
- unrealistic movement speed: rejected as `speed-too-fast`.

## Remaining mobile work

1. Test the Android APK on a physical device.
2. Surface the mobile GPS diagnostics in the app UI, ideally under the GPS/location feed panel.
3. Add foreground-service support if walks should continue reliably while the app is backgrounded.
4. Add a mobile-first permission onboarding screen for location access and privacy controls.
5. Replace the coarse city bounding boxes with more accurate city polygons or per-district bounds.
6. Add a real map/tile layer only if the product direction requires street-level map visuals.
7. Move persistence from browser `localStorage` to a mobile storage adapter, such as Capacitor Preferences or SQLite.

## Device testing checklist

- Build the web bundle and sync Capacitor:

```bash
npm run android:sync
```

- Build a debug APK:

```bash
npm run android:apk
```

- Install/run on a connected device:

```bash
npm run android:run
```

- Verify on device:
  - GPS permission request appears.
  - Denying permission keeps the GPS lane blocked.
  - Granting permission allows samples to enter the location feed.
  - Samples outside the selected city are shown as unmapped.
  - Samples inside the selected city reveal nearby atlas cells.
  - Coarse accepted samples reveal only the current cell.
  - Precise accepted samples reveal neighboring cells.
  - Repeated samples on the same cell do not advance the route.
  - Very stale samples are ignored.
  - Fast jumps across real GPS positions are rejected as unrealistic walking movement.
  - The CI workflow uploads the debug APK artifact after successful test/lint/build checks.
