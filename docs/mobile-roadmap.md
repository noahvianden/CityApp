# Mobile App Roadmap

This branch is dedicated to the mobile version of Cityprint.

## Implemented in this branch

- Added a geo-grid layer that maps real latitude/longitude coordinates into the existing 7 x 8 fog-of-war atlas grid.
- Added city-level geographic bounds for Berlin and Hamburg.
- Updated GPS sample resolution so device GPS is only accepted when it can be mapped into the selected city.
- Changed out-of-city or missing-city GPS samples to return `unmapped` instead of being forced into an arbitrary atlas cell.
- Updated walk-controller GPS behavior to pass the selected city id through the location pipeline.
- Added district-aware GPS context so mapped cells can resolve to a primary district, overlapping district candidates, and nearby authored places.
- Added accuracy-aware GPS reveal behavior:
  - precise GPS samples reveal the current cell plus neighboring cells.
  - coarse-but-accepted GPS samples reveal only the current cell.
  - inaccurate GPS samples are rejected before mapping.
- Replaced grid-only GPS jump rejection with meter-based walking validation.
- Stored the last accepted GPS sample in the walk session so movement speed can be evaluated across real device samples.
- Added mobile GPS diagnostics that summarize sample accuracy, mapped cell, district, reveal radius, movement speed, and rejection reasons for device testing.
- Added an in-app GPS diagnostics overlay that appears after the first GPS sample and expands to show the latest diagnostic details.
- Added native mobile snapshot storage via Capacitor Filesystem while keeping localStorage as the web/dev fallback.
- Added a startup bootstrap step that restores the native snapshot into localStorage before React reads app state.
- Added CI for test, lint, web build, Capacitor sync, and Android debug APK build.
- Added unit tests for geo-grid projection, district resolution, bounds checks, round-tripping cell centers, GPS acceptance, GPS rejection, stale samples, repeated samples, speed-too-fast detection, accuracy-aware reveal radius, diagnostics publishing, snapshot serialization, and mobile diagnostics.

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

## District model

Districts are still authored as sets of atlas cells. A mapped GPS cell can belong to zero, one, or multiple districts. When multiple districts match, Cityprint sorts candidates by district specificity and uses authored places in the same cell to choose a more helpful primary district.

Diagnostics now expose:

- primary district
- overlapping district candidates
- nearby authored places in the mapped cell
- a plain-English district explanation

This prepares the app for district progress, district recaps, and more meaningful discovery copy.

## Mobile storage model

The app still uses localStorage as the synchronous in-memory/browser-facing source for the React app. On native mobile, a startup bridge restores the latest Capacitor Filesystem snapshot into localStorage before React renders.

After startup, every normal snapshot write emits a `cityprint:snapshot-written` event. The native snapshot mirror listens to that event and writes the sanitized snapshot to app-private native storage under `Directory.Data`.

Important privacy behavior:

- precise GPS coordinates are stripped before serialization.
- GPS accuracy is stripped before serialization.
- only GPS mode and permission state are persisted.
- backup snapshots follow the existing `backupEnabled` privacy setting.

## In-app diagnostics overlay

The mobile app now renders a compact GPS diagnostics overlay at the bottom of the screen after the first GPS sample is processed by the walk controller.

The collapsed overlay shows:

- accepted/rejected state
- mapped cell or `No cell`
- primary district if available
- reason such as `gps`, `unmapped`, `accuracy-too-low`, `stale-sample`, or `speed-too-fast`
- timestamp of the diagnostic

Tapping the overlay expands it and shows:

- primary district
- overlapping district candidates
- nearby authored places
- accuracy label
- reveal radius
- movement speed
- approximate atlas cell size
- diagnostic messages explaining why the sample was accepted or rejected

## Remaining mobile work

1. Test the Android APK on a physical device.
2. Add foreground-service support if walks should continue reliably while the app is backgrounded.
3. Add a mobile-first permission onboarding screen for location access and privacy controls.
4. Replace the coarse city bounding boxes with more accurate city polygons or per-district bounds.
5. Add district progress and district recap surfaces using the new district resolver.
6. Add a real map/tile layer only if the product direction requires street-level map visuals.
7. Decide whether the diagnostics overlay should remain developer-only or become a hidden debug setting before release.
8. Consider replacing the JSON snapshot store with SQLite only if progress/memories become too large for single-file snapshots.

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
  - The diagnostics overlay appears after the first GPS sample reaches the walk controller.
  - Samples outside the selected city are shown as unmapped.
  - Samples inside the selected city reveal nearby atlas cells.
  - Mapped samples show district context when the cell belongs to a district.
  - Cells with overlapping districts show candidate district context.
  - Coarse accepted samples reveal only the current cell.
  - Precise accepted samples reveal neighboring cells.
  - Repeated samples on the same cell do not advance the route.
  - Very stale samples are ignored.
  - Fast jumps across real GPS positions are rejected as unrealistic walking movement.
  - App progress survives a full app restart through the native snapshot bridge.
  - Precise GPS coordinates do not appear in exported/local/native snapshot data.
  - The CI workflow uploads the debug APK artifact after successful test/lint/build checks.
