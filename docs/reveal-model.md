# Cityprint Reveal Model

This note turns the current simulated fog-of-war prototype into rules that can survive a later native GPS and map-provider implementation.

## Product Contract

Cityprint reveals a city through physical movement. It does not rank places, optimize routes, or provide in-app turn-by-turn navigation. The map should make explored and unexplored areas clear without exposing exact movement by default.

## Spatial Units

Use reveal cells as the durable progress unit.

- `cell_id`: stable id for a small map segment.
- `state`: `hidden`, `partial`, `recent`, or `revealed`.
- `district_id`: optional district grouping for progress.
- `revealed_at`: timestamp of the first reveal.
- `last_seen_at`: timestamp of the last qualifying movement sample.

For the current prototype, a cell is a simple grid coordinate such as `3-5`. For a real map, use a hex grid or Web Mercator tile-derived grid so each cell can be stored and queried independently. Start with cells around 90-130 meters across in dense city areas. This is large enough to avoid exact route replay, but small enough to feel responsive while walking.

## Reveal Rules

Movement reveals cells only when location quality is good enough.

- Accept foreground samples with accuracy <= 50 meters.
- Ignore samples that imply impossible movement speed for walking, unless the user explicitly chose a non-walk mode later.
- Reveal the current cell and adjacent street-connected cells.
- Mark a cell `recent` for about 90 seconds after first reveal, then persist it as `revealed`.
- Mark neighboring cells `partial` visually, but do not unlock places in partial cells.
- Pause discovery feedback when new places appear so the user can inspect the result.

In the current web prototype, a GPS sample is treated as stale when it is older than the most recent accepted sample or arrives more than about 30 seconds late, and it is treated as too fast when it jumps more than one reveal cell in roughly 45 seconds. Simulated samples bypass those guards so the demo route can still advance at prototype speed.

The prototype already follows the important behavioral rule: new places are only visible when their assigned cell is in `revealedCells`.

## Place Visibility

A place is discoverable when all of these are true:

- Its `cell_id` is revealed.
- It is not hidden by a privacy rule.
- It belongs to the selected city.
- The user has not disabled the place category in a future filter.

Place details may offer an external navigation handoff, but Cityprint should not draw route guidance or optimize a route internally.

## Privacy Defaults

Store progress and memories locally first. Exact route points should be short-lived unless the user opts into backup or export.

- Recaps use revealed cells or generalized route fragments, not raw GPS points.
- Home/work blur zones override map fragments and recap exports.
- Sensitive places can be hidden from recaps and shared views.
- Memory visibility defaults to private.
- Data export should clearly separate memories, places, revealed cells, and raw route points if raw points ever become user-exportable.

## Data Shape

Minimum local tables or collections:

- `cities(id, name, country, selected_at)`
- `cells(id, city_id, district_id, geometry_ref, state, revealed_at, last_seen_at)`
- `route_samples(id, city_id, lat, lon, accuracy_m, captured_at, retained_until)`
- `places(id, city_id, cell_id, name, category, district_id, description)`
- `memories(id, city_id, place_id, cell_id, title, text, tag, visibility, created_at)`
- `privacy_zones(id, city_id, kind, geometry_ref, blur_radius_m, enabled)`

The current web prototype persists a browser-local snapshot under `cityprint:v1`. It stores the selected city, privacy settings, and per-city progress (`revealedCells`, `seenPlaceIds`, `savedPlaceIds`, `routeIndex`, and `memories`). Raw GPS samples are intentionally not represented yet.

The Privacy screen also exposes two operational controls:

- Export preview shows the exact browser-local snapshot that would be exported.
- Reset clears the local snapshot and returns the app to default privacy settings and an empty city-progress state.

## Implementation Sequence

1. Replace demo route arrays with a location-sample adapter that can accept simulated points now and GPS points later.
2. Add a reset/export surface for local data so privacy controls become operational, not only descriptive.
3. Move browser-local persistence to encrypted native storage when the project becomes a React Native app.
4. Only then evaluate native GPS and map-provider integration.
