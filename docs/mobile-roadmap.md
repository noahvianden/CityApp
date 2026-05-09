# Mobile App Roadmap

This branch is dedicated to the mobile version of Cityprint.

## Implemented in this branch

- Added a geo-grid layer that maps real latitude/longitude coordinates into the existing 7 x 8 fog-of-war atlas grid.
- Added city-level geographic bounds for Berlin and Hamburg.
- Updated GPS sample resolution so device GPS is only accepted when it can be mapped into the selected city.
- Changed out-of-city or missing-city GPS samples to return `unmapped` instead of being forced into an arbitrary atlas cell.
- Updated walk-controller GPS behavior to pass the selected city id through the location pipeline.
- Added unit tests for geo-grid projection, bounds checks, round-tripping cell centers, GPS acceptance, GPS rejection, stale samples, repeated samples, and speed-too-fast detection.

## Current GPS model

Cityprint still uses the custom fog-of-war atlas UI. The mobile GPS layer now projects real GPS coordinates into this atlas by using each city's geographic bounding box.

This is intentionally simpler than a full map-provider integration. It is good enough for early device testing because it answers the first mobile question:

> Is the user physically inside the selected city, and which atlas cell should this GPS sample reveal?

## Remaining mobile work

1. Test the Android APK on a physical device.
2. Add foreground-service support if walks should continue reliably while the app is backgrounded.
3. Add a mobile-first permission onboarding screen for location access and privacy controls.
4. Replace the coarse city bounding boxes with more accurate city polygons or per-district bounds.
5. Add a real map/tile layer only if the product direction requires street-level map visuals.
6. Move persistence from browser `localStorage` to a mobile storage adapter, such as Capacitor Preferences or SQLite.
7. Add CI for `npm run test`, `npm run lint`, and `npm run build`.

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
  - Repeated samples on the same cell do not advance the route.
  - Very stale samples are ignored.
  - Fast jumps across cells are rejected as unrealistic walking movement.
