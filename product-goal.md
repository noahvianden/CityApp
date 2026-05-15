# Cityprint Product Goal

Cityprint is a mobile app for gamified local exploration. Locals reveal their city by walking, clear fog around their GPS path, discover selected real-world places, and build visible progress across cities, districts, walks, places, and photos.

## Current Development Goal

The immediate priority is to make the Atlas feel excellent:

- live GPS-based fog reveal
- automatic walk detection
- background walk tracking on mobile
- real city and district boundaries
- real place discovery from map data
- a soft game-board map style
- multiple city support
- city and district completion
- lightweight walk cards
- optional mission suggestions

Dedicated privacy features are not a current product goal. The app should still handle location responsibly, but privacy-specific screens, private recaps, blur zones, sensitive-place management, and export/privacy controls should not drive the near-term design.

## Product Shape

Cityprint is a mix between a game and a city companion. It should feel grounded, calm, and useful, but the core motivation is progress through exploration.

The app is for locals who want a reason to walk through familiar and unfamiliar parts of their own city. It is not primarily a tourist guide, review platform, fitness tracker, navigation app, or public social network.

## Core Promise

Walk in the real world and reveal your city.

The strongest moments should be:

- fog clearing live around the user's movement
- district reveal progress growing over time
- a district becoming meaningfully explored
- interesting real places appearing as discoveries
- the city map becoming a personal record of walks

## Core Loop

1. The user opens the app on the Atlas.
2. The app detects walking and starts revealing immediately.
3. Fog clears in a normal-radius area around the GPS path.
4. Interesting real places appear immediately when revealed.
5. The app mostly stays quiet during the walk, except for live place pop-ups.
6. Completed walks become walk cards.
7. Progress updates for city completion, district completion, and category collections.
8. Optional missions suggest what to explore next.

## Main Navigation

The planned main tabs are:

- `Atlas`: the primary map, live reveal, city switching, visible places, and mission suggestions.
- `Walks`: completed walk cards with distance/time, revealed area, discovered places, photos, and route preview where useful.
- `Journal`: saved places, visited places, favorites, want-to-go places, photos, and memories. This is not a near-term priority.
- `Progress`: city completion, district completion, category collections, stamps, themes, fog styles, and city title cards.

The app should always open to `Atlas`.

## Atlas

Purpose: the main experience.

The Atlas should include:

- current city
- city switching for multiple cities
- hybrid soft game-board map
- real city boundary
- district boundaries from real map data where possible
- fog of war
- live current location
- revealed areas
- selected interesting real places
- optional mission suggestions
- city and district progress

Required behavior:

- reveal around the GPS path live
- keep revealing in the background on mobile
- show interesting places immediately when their area is revealed
- show place pop-ups during walks
- support multiple cities
- avoid noisy interruptions while walking

## Walks

Purpose: keep a useful record of exploration without making the app feel like a fitness tracker.

Walk cards should include:

- city
- date
- distance
- duration
- revealed area summary
- districts touched
- discovered places
- attached photos or memories
- route preview when useful

Near-term behavior:

- walks can be created from automatic walk detection
- route details do not need to be the main focus
- no post-walk summary is required for now

## Progress

Purpose: show what has been revealed and what remains.

Progress should include:

- city completion
- district completion
- category collections
- revealed area percentage
- places found
- walks completed
- cosmetic rewards

Completion should exist at three levels:

- city-wide completion
- district-by-district completion
- category collections

Achievements are not a current priority. Cosmetic rewards are acceptable for now, especially:

- fog styles
- map themes
- district stamps
- city title cards

## Missions

Missions should be optional suggestions, not a forced route.

Mission sources can mix:

- current location
- unfinished districts
- categories the user tends to like
- nearby hidden areas
- random nearby exploration prompts

Supported mission types:

- reveal a nearby hidden area
- discover a cafe, park, culture place, viewpoint, market, shop, restaurant, bar, or landmark
- reach a new district
- complete a district slice
- take a photo at a discovered place

Do not include walking streaks. Do not push the user toward fitness-app behavior.

## Places

Place discovery should use real map data. The MVP can use whichever source is best for reliability and development speed, including OpenStreetMap/Overpass, but the product should prefer fewer, better places over showing every possible matching result.

Supported MVP categories:

- cafe
- restaurant
- bar
- park
- gallery
- museum / culture
- viewpoint
- market
- shop
- landmark

Place states should include:

- saved
- visited
- favorite
- want to go

Places should appear immediately when revealed.

## Photos And Memories

Users should eventually be able to save:

- places
- written memories
- photos
- visited areas
- routes
- favorite districts

Custom notes are not a goal.

Photos should be possible from both:

- phone camera
- choosing/uploading existing photos

Photos and memories can belong to:

- a place
- a walk
- a district
- the current GPS spot

The full journal is not a near-term priority, but the data model should not block it.

## Social Features

Social features are intended later, but not for the current build.

Future social directions may include:

- friends
- shared progress
- challenges
- shared discoveries
- recommended discoveries
- walking together

Public profiles and public-facing features are not planned for now.

## Map Direction

The map should be a hybrid: real enough for orientation, but styled like a soft game board.

Map requirements:

- readable streets
- clear districts
- visible parks and water
- soft, playful fog
- discovered places as meaningful markers
- progress visible without feeling like a spreadsheet

## Copy Rules

Use grounded language for now.

Preferred terms:

- revealed
- discovered
- walked
- district
- place
- saved
- progress
- mission
- collection

Avoid for now:

- XP
- leaderboard
- ranking
- top rated
- best near you
- optimize route
- walking streak
- public profile

## MVP Priority

The next development phase should remove or replace privacy-oriented UI and focus on live fog reveal.

Highest priority:

1. Live GPS reveal feels responsive and satisfying.
2. Background walking works on Android.
3. Revealed areas persist per city.
4. Interesting real places appear only when revealed.
5. The Atlas looks like a soft game-board city map.
6. Progress for city and district reveal is visible.
7. The old Privacy tab is replaced by a more relevant tab.

The detailed implementation-oriented plan is maintained in [next-development-steps.md](next-development-steps.md).
