# Cityprint Next Development Steps

This document translates the current product direction into implementation-focused development steps. Every item describes what changes, how it should work for the user, and how it should work inside the app.

## 1. Rework Main Navigation

**What to change**

Replace the old privacy-era navigation direction with the planned tabs:

- `Atlas`
- `Walks`
- `Journal`
- `Progress`

`Atlas` remains the default entry point. `Journal` can stay lightweight for now, but the tab should point toward saved places, photos, and memories rather than privacy controls.

**How it works for the user**

When the user opens Cityprint, they land directly on the Atlas. The bottom navigation clearly communicates the app structure: explore now, review walks, see saved discoveries later, and track progress.

The user should no longer see privacy as one of the main product pillars.

**How it works inside the app**

- Update the app tab model to use `atlas`, `walks`, `journal`, and `progress`.
- Remove or replace UI text and placeholder content tied to the old privacy tab.
- Keep `Atlas` as the initial active tab.
- Route future saved-place and memory UI into `Journal`.
- Route city and district completion UI into `Progress`.
- Make sure any bridge code or DOM enhancement logic that currently looks for `memories`, `stats`, or `privacy` is updated to the new tab names.

**Status - 2026-05-16**

Completed the first live-reveal quality pass. GPS point features now carry an accuracy-aware reveal radius, and the fog bridge uses that radius when it writes reveal points, so weaker samples clear less map instead of behaving like perfect fixes. Per-city fog persistence and interpolation are still in place.

Remaining work in this area: feed native watch samples directly into the reveal pipeline instead of routing through a fresh GPS lookup, then tighten any remaining sample rejection rules.

Recommended next slice: keep step 3 and wire live GPS samples straight through the reveal path so the app uses the actual watch sample and not a re-fetched location update.

## 2. Make Atlas The Primary Product Surface

**What to change**

Make the Atlas feel like the complete first screen of the app, not just a map view. It should show the current city, live position, fog, revealed areas, visible places, mission suggestions, and progress hints.

**How it works for the user**

The user opens the app and immediately understands what to do: walk to reveal the city. The map should feel active and game-like, but still useful for local orientation.

The Atlas should stay quiet during walks except when a meaningful place is discovered.

**How it works inside the app**

- Keep city selection and active city state in the Atlas controller.
- Feed live reveal progress from the fog system into Atlas UI.
- Render city and district progress near the map without forcing the user into another tab.
- Keep place cards attached to map place markers.
- Add a compact mission area that can be ignored.
- Avoid separate modal-heavy flows during active walking.

## 3. Improve Live GPS Fog Reveal

**What to change**

Make live fog reveal the highest-quality feature. Fog should clear around the user's real GPS path with a normal walking-radius reveal.

**How it works for the user**

As the user walks, fog clears naturally around them. The reveal should feel smooth, immediate, and satisfying. The user should see that their physical movement directly changes the map.

If GPS quality is weak, the app should avoid strange jumps or overly large reveals.

**How it works inside the app**

- Convert each accepted GPS sample into a reveal point.
- Reveal a radius around each sample.
- If the user moved between two accepted samples, interpolate reveal points along that path so the fog clears as a continuous trail.
- Reject or reduce low-quality samples based on accuracy.
- Persist reveal data per city, not globally.
- Keep the current organic fog canvas, but tune radius, opacity, and transitions toward a soft game-board feel.
- Publish reveal progress so Atlas and Progress can read it.

## 4. Add Automatic Walk Detection

**What to change**

Remove the need for a manual start-walk action. Walking should start reveal automatically.

**How it works for the user**

The user opens the app, starts walking, and reveal begins. They should not need to press a start button. The app should not start a walk just because GPS jitters while the user is standing still.

**How it works inside the app**

- Add a walk state machine: `idle`, `detecting`, `active`, `paused`, `ended`.
- Watch GPS samples while Atlas is active and, on Android, while background tracking is enabled.
- Ignore tiny movements that look like GPS jitter.
- Start an active walk after movement passes distance/time thresholds.
- Keep revealing immediately when a sample is accepted, even while the walk is being classified.
- Pause or end a walk after a stillness timeout.
- Store a lightweight walk record when the walk ends.

## 5. Support Background Reveal On Android

**What to change**

Make walking and reveal continue when the Android app is backgrounded or the screen is locked.

**How it works for the user**

The user can put the phone away during a walk. When they reopen Cityprint, the Atlas shows the areas they revealed while the app was not visible.

**How it works inside the app**

- Use Capacitor-compatible background location support. If the current plugins are not enough, install and configure the needed plugin in a reusable way for future chats.
- Add required Android permissions and service configuration.
- Buffer background GPS samples with timestamps, accuracy, and city context.
- On app resume, apply buffered samples to fog reveal and active walk state.
- Keep background behavior focused on reveal and walk cards, not fitness tracking.
- Make sure foreground and background samples use the same reveal pipeline.

## 6. Persist Multiple Cities Cleanly

**What to change**

Support multiple active city atlases with separate progress.

**How it works for the user**

The user can explore Cologne, Berlin, Hamburg, or another city without losing progress. Switching cities restores that city's fog, discovered places, walks, and progress.

**How it works inside the app**

- Use a stable city key for every persisted feature.
- Store fog reveal data per city.
- Store place states per city.
- Store walk cards per city.
- Store progress summaries per city or derive them from reveal data.
- Remember the last active city.
- Keep search and city history as the user's city switcher.

## 7. Improve Real Place Discovery Quality

**What to change**

Show fewer, better real places from map data.

Supported near-term categories:

- cafes
- restaurants
- bars
- parks
- galleries
- museums / culture
- viewpoints
- markets
- shops
- landmarks

**How it works for the user**

The user sees interesting places appear as the fog clears. The app should feel curated, not cluttered. Place discovery should feel like a reward for revealing an area.

**How it works inside the app**

- Continue using real map data, currently OpenStreetMap/Overpass unless another source becomes more reliable.
- Filter out unnamed or low-value entries.
- Dedupe places by name, category, and approximate location.
- Rank places by category value, proximity, and basic data quality.
- Only render places that are inside the active city boundary.
- Only render places whose coordinates are inside revealed areas.
- Cache place results per city and search area to avoid repeated network requests.

## 8. Add Full Place States

**What to change**

Each place should support these user states:

- `saved`
- `visited`
- `favorite`
- `want to go`

**How it works for the user**

When the user opens a place card, they can quickly mark what the place means to them. Saved places and want-to-go places become useful later in the Journal. Favorites and visited places contribute to collections and progress.

**How it works inside the app**

- Extend place state storage beyond the current saved/visited/memory ids.
- Store state by city and place id.
- Let place cards toggle each state independently.
- Keep state changes instant and local.
- Expose selectors/helpers so Atlas, Journal, and Progress can all read the same place state.
- Avoid duplicate saved-place snapshots when place data refreshes from map data.

## 9. Add District Completion

**What to change**

Track reveal progress per district. District reveal matters more than achievements right now.

**How it works for the user**

The user should see that each district has its own progress. Finishing or nearly finishing a district should feel meaningful even before cosmetic stamps or rewards are added.

**How it works inside the app**

- Load district or neighborhood boundaries from real map data where possible.
- Associate reveal points or revealed coverage with districts.
- Estimate district completion by sampling each district polygon and checking which samples are revealed.
- Cache computed progress so the UI remains responsive.
- Show progress first on the Atlas, then in the Progress tab.
- Keep completion logic flexible because different cities may have different boundary quality.

## 10. Create Walk Cards

**What to change**

Add completed walk cards as the first real version of the `Walks` tab.

**How it works for the user**

After walking, the user can open `Walks` and see a calm record of completed walks. It should not feel like a fitness app. The card should emphasize exploration: revealed area, districts touched, and discovered places.

**How it works inside the app**

- Use the automatic walk detector to create walk sessions.
- Track start time, end time, distance estimate, city, revealed point count, districts touched, and places discovered during the session.
- Store completed sessions as walk cards.
- Show the newest walks first.
- Include route preview only if it helps the exploration record.
- Do not add a post-walk summary screen yet.

## 11. Add Optional Mission Suggestions

**What to change**

Add lightweight missions that suggest what to explore next without forcing a route.

Mission types:

- reveal a nearby hidden area
- discover a cafe, park, culture place, viewpoint, market, shop, restaurant, bar, or landmark
- reach a new district
- complete a district slice
- take a photo at a discovered place

**How it works for the user**

The user sees one or a few optional prompts. They can ignore them and keep walking freely. Missions should feel like inspiration, not instruction.

**How it works inside the app**

- Generate missions from current location, unrevealed nearby areas, unfinished districts, known place categories, and random nearby prompts.
- Store active mission suggestions per city.
- Mark missions complete when reveal/place/photo conditions are met.
- Avoid streaks, leaderboards, or competitive language.
- Keep mission UI compact on the Atlas.

## 12. Build Progress And Cosmetic Rewards Foundation

**What to change**

Create a Progress tab focused on city completion, district completion, and category collections. Cosmetic rewards can come later but should be represented in the model.

**How it works for the user**

The user can see how much of a city and its districts they have revealed. They can also see category collection progress, such as parks discovered or cafes found.

Later, visual rewards can unlock fog styles, map themes, district stamps, and city title cards.

**How it works inside the app**

- Derive city completion from revealed coverage inside the active city boundary.
- Derive district completion from district reveal sampling.
- Derive category collections from discovered/visited/favorite place state.
- Add reward records with unlock conditions, even if the first UI only shows locked/unlocked placeholders.
- Keep rewards cosmetic only for now.

## 13. Prepare Photos And Memories Data

**What to change**

Do not build the full Journal yet, but make the data model ready for photos and memories.

**How it works for the user**

Later, the user will be able to attach photos and memories to a place, walk, district, or GPS spot. They should be able to use the camera or choose an existing photo.

**How it works inside the app**

- Define attachment records with type, timestamp, city id, optional place id, optional walk id, optional district id, and optional coordinate.
- Keep custom notes out of scope.
- Leave room for text memories, but do not make Journal a near-term dependency.
- Store attachment metadata separately from large photo files.
- On Android, use reusable native file/camera integrations when this feature is implemented.

## 14. Push The Map Toward A Soft Game Board

**What to change**

Adjust visual styling so the map feels like a soft game-board city while staying useful.

**How it works for the user**

The user should recognize real streets, parks, water, districts, and places, but the overall feel should be more playful and collectible than a standard map app.

**How it works inside the app**

- Tune the MapLibre style for softer colors, clearer district edges, and less visual clutter.
- Keep streets readable at walking zoom levels.
- Make parks and water strong orientation anchors.
- Tune fog color, opacity, and reveal edges.
- Use place marker styling that feels collectible without becoming noisy.
- Keep visual progress visible directly on the map.

## 15. Keep Internet-Only MVP Assumptions

**What to change**

Accept that the MVP requires internet access.

**How it works for the user**

The app can depend on live map/place data for now. Offline behavior does not need to be solved before live reveal feels good.

**How it works inside the app**

- Keep map and place requests online-first.
- Cache useful city, place, and reveal data opportunistically.
- Handle failed place/map requests gracefully.
- Do not block local reveal persistence just because a network request fails.

## 16. Development Order

Build in this order:

1. Rework navigation and replace privacy-era UI.
2. Improve live GPS reveal and persistence per city.
3. Add automatic walk detection.
4. Add Android background reveal.
5. Improve real place quality and reveal gating.
6. Add place states.
7. Add district completion.
8. Add Walks tab cards.
9. Add optional missions.
10. Build Progress tab foundations.
11. Prepare photos and memories data.
12. Polish the soft game-board map style.

