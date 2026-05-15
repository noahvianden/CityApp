export type Category =
  | 'cafe'
  | 'restaurant'
  | 'park'
  | 'bar'
  | 'gallery'
  | 'shop'
  | 'culture'
  | 'viewpoint'
  | 'market'
  | 'quiet_spot'
  | 'landmark'

export type Place = {
  id: string
  name: string
  category: Category
  district: string
  description: string
  discoveryContext: string
  cell: string
  x: number
  y: number
  latitude?: number
  longitude?: number
}

export type District = {
  id: string
  name: string
  cells: string[]
}

export type MapLabel = {
  text: string
  x: number
  y: number
  tone?: 'light' | 'dark'
}

export type MapRegion = {
  id: string
  name: string
  d: string
  labelX: number
  labelY: number
}

export type CityMap = {
  water: string[]
  parks: string[]
  streetsMajor: string[]
  streetsMinor: string[]
  regions: MapRegion[]
  labels: MapLabel[]
}

export type City = {
  id: string
  name: string
  country: string
  status: string
  savedProgress: number
  description: string
  initialRevealed: string[]
  walkRoute: string[]
  districts: District[]
  places: Place[]
  map: CityMap
}

const cells = (matcher: (x: number, y: number) => boolean) => {
  const output: string[] = []

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      if (matcher(x, y)) {
        output.push(`${x}-${y}`)
      }
    }
  }

  return output
}

export const genericCurrentCity: City = {
  id: 'local-current-city',
  name: 'Live city',
  country: 'Local GPS',
  status: 'GPS atlas',
  savedProgress: 0,
  description: 'A local atlas generated around your first GPS sample, ready for live walking and private discovery.',
  initialRevealed: ['3-4'],
  walkRoute: ['3-4', '3-3', '4-3', '4-4', '4-5', '3-5', '2-5', '2-4', '2-3', '3-2', '4-2', '5-2'],
  districts: [
    {
      id: 'local-center',
      name: 'Local Center',
      cells: cells((x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 5),
    },
    {
      id: 'north-side',
      name: 'North Side',
      cells: cells((_x, y) => y <= 2),
    },
    {
      id: 'east-side',
      name: 'East Side',
      cells: cells((x) => x >= 5),
    },
    {
      id: 'south-side',
      name: 'South Side',
      cells: cells((_x, y) => y >= 5),
    },
    {
      id: 'west-side',
      name: 'West Side',
      cells: cells((x) => x <= 1),
    },
  ],
  places: [
    {
      id: 'local-start',
      name: 'Current Position',
      category: 'viewpoint',
      district: 'Local Center',
      description: 'The active GPS anchor for this local atlas.',
      discoveryContext: 'Created when Cityprint begins mapping your current area.',
      cell: '3-4',
      x: 50,
      y: 55,
    },
    {
      id: 'local-north',
      name: 'Northern Landmark',
      category: 'landmark',
      district: 'North Side',
      description: 'A nearby landmark discovery in the northern part of your live city atlas.',
      discoveryContext: 'Revealed as the local atlas expands north from your route.',
      cell: '3-2',
      x: 50,
      y: 29,
    },
    {
      id: 'local-east',
      name: 'Eastern Green Space',
      category: 'park',
      district: 'East Side',
      description: 'A green-space discovery on the eastern side of your live city atlas.',
      discoveryContext: 'Revealed as the local atlas expands east from your route.',
      cell: '5-3',
      x: 78,
      y: 43,
    },
    {
      id: 'local-south',
      name: 'Southern Cafe Area',
      category: 'cafe',
      district: 'South Side',
      description: 'A cafe-area discovery in the southern part of your live city atlas.',
      discoveryContext: 'Revealed as the local atlas expands south from your route.',
      cell: '3-6',
      x: 50,
      y: 82,
    },
    {
      id: 'local-west',
      name: 'Western Quiet Corner',
      category: 'quiet_spot',
      district: 'West Side',
      description: 'A quieter local discovery on the western side of your live city atlas.',
      discoveryContext: 'Revealed as the local atlas expands west from your route.',
      cell: '1-4',
      x: 22,
      y: 55,
    },
  ],
  map: {
    water: ['M0 654 C126 618 194 682 326 654 S534 622 700 686 L700 800 L0 800 Z'],
    parks: [
      'M486 206 C604 178 684 244 664 344 C640 422 548 424 506 362 C468 306 468 232 486 206 Z',
      'M40 406 C120 356 206 374 206 452 C204 532 84 540 42 478 C24 446 23 418 40 406 Z',
    ],
    streetsMajor: [
      'M92 0 L128 150 L104 314 L160 474 L150 800',
      'M300 0 L286 188 L328 340 L318 520 L372 800',
      'M598 0 L544 166 L574 332 L530 514 L610 800',
      'M0 180 L160 160 L310 190 L480 156 L700 176',
      'M0 388 L176 350 L342 384 L514 356 L700 392',
      'M0 584 L190 612 L344 578 L526 615 L700 580',
    ],
    streetsMinor: ['M212 0 L198 800', 'M458 0 L438 800', 'M0 284 L700 286', 'M0 494 L700 486'],
    regions: [
      {
        id: 'local-center',
        name: 'Local Center',
        d: 'M192 210 L372 178 L504 224 L490 482 L330 532 L214 444 Z',
        labelX: 334,
        labelY: 370,
      },
      {
        id: 'north-side',
        name: 'North Side',
        d: 'M166 0 L700 0 L690 172 L520 184 L356 158 L206 176 Z',
        labelX: 420,
        labelY: 92,
      },
      {
        id: 'east-side',
        name: 'East Side',
        d: 'M460 166 L700 164 L700 550 L548 528 L504 388 Z',
        labelX: 608,
        labelY: 362,
      },
      {
        id: 'south-side',
        name: 'South Side',
        d: 'M268 528 L496 500 L700 540 L700 800 L238 800 L228 634 Z',
        labelX: 472,
        labelY: 680,
      },
      {
        id: 'west-side',
        name: 'West Side',
        d: 'M0 164 L184 146 L226 428 L160 544 L0 534 Z',
        labelX: 108,
        labelY: 346,
      },
    ],
    labels: [
      { text: 'Current area', x: 330, y: 374, tone: 'dark' },
      { text: 'Local route', x: 532, y: 742, tone: 'light' },
    ],
  },
}

export const cities: City[] = [
  genericCurrentCity,
  {
    id: 'berlin',
    name: 'Berlin',
    country: 'Germany',
    status: 'Live real places',
    savedProgress: 14,
    description: 'Wide blocks, canals, parks, and real Berlin places revealed by walking.',
    initialRevealed: ['2-5', '3-5', '3-6'],
    walkRoute: ['3-6', '3-5', '3-4', '4-4', '4-3', '5-3', '5-2', '4-2', '3-2', '2-2'],
    districts: [
      {
        id: 'canal',
        name: 'Canal Quarter',
        cells: cells((x, y) => x <= 2 && y >= 4),
      },
      {
        id: 'old-center',
        name: 'Old Center',
        cells: cells((x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 5),
      },
      {
        id: 'market',
        name: 'Market North',
        cells: cells((_x, y) => y <= 2),
      },
      {
        id: 'garden',
        name: 'Garden East',
        cells: cells((x, y) => x >= 5 && y >= 3),
      },
      {
        id: 'station',
        name: 'Station South',
        cells: cells((x, y) => x >= 3 && y >= 6),
      },
    ],
    places: [
      {
        id: 'linden-cafe',
        name: 'Brandenburg Gate',
        category: 'landmark',
        district: 'Old Center',
        description: "Historic neoclassical city gate and one of Berlin's most recognizable landmarks.",
        discoveryContext: 'Revealed when the walk reaches the historic center around Pariser Platz.',
        cell: '3-5',
        x: 50,
        y: 69,
        latitude: 52.516275,
        longitude: 13.377704,
      },
      {
        id: 'canal-bench',
        name: 'Museum Island',
        category: 'culture',
        district: 'Old Center',
        description: 'Cluster of major museums on the Spree island in central Berlin.',
        discoveryContext: 'Appears as a culture marker after the central island area is uncovered.',
        cell: '2-5',
        x: 34,
        y: 72,
        latitude: 52.5169,
        longitude: 13.4019,
      },
      {
        id: 'arcade-house',
        name: 'East Side Gallery',
        category: 'gallery',
        district: 'Garden East',
        description: 'Open-air gallery painted on a preserved section of the Berlin Wall.',
        discoveryContext: 'Discovered after revealing the eastern Spree-side streets.',
        cell: '4-4',
        x: 64,
        y: 55,
        latitude: 52.505,
        longitude: 13.4397,
      },
      {
        id: 'north-market',
        name: 'Markthalle Neun',
        category: 'market',
        district: 'Market North',
        description: 'Historic market hall known for food stalls, local producers, and events.',
        discoveryContext: "Revealed when the route crosses into Kreuzberg's market streets.",
        cell: '4-2',
        x: 62,
        y: 28,
        latitude: 52.50208,
        longitude: 13.43161,
      },
      {
        id: 'east-garden',
        name: 'Tempelhofer Feld',
        category: 'park',
        district: 'Garden East',
        description: 'Former airport field turned into a huge public park and open-air route.',
        discoveryContext: 'Shows up as a green discovery marker when southern open space is explored.',
        cell: '5-3',
        x: 78,
        y: 43,
        latitude: 52.473,
        longitude: 13.403,
      },
      {
        id: 'station-hall',
        name: 'Berlin Hauptbahnhof',
        category: 'landmark',
        district: 'Station South',
        description: "Berlin's central railway station, connecting the walk to the wider city.",
        discoveryContext: 'Saved from a previous walk near the southern tracks.',
        cell: '4-6',
        x: 63,
        y: 83,
        latitude: 52.5251,
        longitude: 13.3694,
      },
    ],
    map: {
      water: ['M0 630 C112 596 182 705 314 662 S528 610 700 684 L700 800 L0 800 Z'],
      parks: [
        'M490 214 C606 186 682 252 664 342 C644 423 553 420 510 360 C474 310 474 238 490 214 Z',
        'M38 406 C118 356 204 374 206 452 C204 532 84 540 42 478 C24 446 23 418 38 406 Z',
      ],
      streetsMajor: [
        'M92 0 L128 150 L104 314 L160 474 L150 800',
        'M300 0 L286 188 L328 340 L318 520 L372 800',
        'M598 0 L544 166 L574 332 L530 514 L610 800',
        'M0 180 L160 160 L310 190 L480 156 L700 176',
        'M0 388 L176 350 L342 384 L514 356 L700 392',
        'M0 584 L190 612 L344 578 L526 615 L700 580',
      ],
      streetsMinor: ['M212 0 L198 800', 'M458 0 L438 800', 'M0 284 L700 286', 'M0 494 L700 486'],
      regions: [
        {
          id: 'canal',
          name: 'Canal Quarter',
          d: 'M0 364 L168 326 L230 388 L224 800 L0 800 Z',
          labelX: 94,
          labelY: 626,
        },
        {
          id: 'old-center',
          name: 'Old Center',
          d: 'M192 210 L372 178 L504 224 L490 482 L330 532 L214 444 Z',
          labelX: 334,
          labelY: 370,
        },
        {
          id: 'market',
          name: 'Market North',
          d: 'M212 0 L494 0 L478 204 L330 224 L166 176 Z',
          labelX: 342,
          labelY: 116,
        },
        {
          id: 'garden',
          name: 'Garden East',
          d: 'M460 166 L700 164 L700 550 L548 528 L504 388 Z',
          labelX: 608,
          labelY: 362,
        },
        {
          id: 'station',
          name: 'Station South',
          d: 'M268 528 L496 500 L700 540 L700 800 L238 800 L228 634 Z',
          labelX: 472,
          labelY: 680,
        },
      ],
      labels: [
        { text: 'Spree Water', x: 532, y: 742, tone: 'light' },
        { text: 'Old Center', x: 328, y: 374, tone: 'dark' },
        { text: 'Canal Edge', x: 102, y: 622, tone: 'light' },
      ],
    },
  },
  {
    id: 'hamburg',
    name: 'Hamburg',
    country: 'Germany',
    status: 'Live real places',
    savedProgress: 0,
    description: 'A fresh city with water, markets, and real Hamburg places hidden under fog.',
    initialRevealed: ['3-5', '3-6'],
    walkRoute: ['3-6', '3-5', '2-5', '2-4', '3-4', '4-4', '4-3', '5-3', '5-2'],
    districts: [
      {
        id: 'harbor',
        name: 'Harbor Edge',
        cells: cells((_x, y) => y >= 5),
      },
      {
        id: 'warehouse',
        name: 'Warehouse Blocks',
        cells: cells((x, y) => x <= 2 && y >= 2 && y <= 5),
      },
      {
        id: 'market',
        name: 'Market Ring',
        cells: cells((x, y) => x >= 3 && y >= 2 && y <= 4),
      },
      {
        id: 'north',
        name: 'North Commons',
        cells: cells((_x, y) => y <= 1),
      },
    ],
    places: [
      {
        id: 'harbor-steps',
        name: 'Elbphilharmonie',
        category: 'culture',
        district: 'Harbor Edge',
        description: 'Concert hall above the harbor with a public plaza and waterfront views.',
        discoveryContext: 'Revealed when the harbor edge opens into HafenCity.',
        cell: '3-6',
        x: 50,
        y: 82,
        latitude: 53.54133,
        longitude: 9.98413,
      },
      {
        id: 'roaster-yard',
        name: 'Speicherstadt',
        category: 'landmark',
        district: 'Warehouse Blocks',
        description: 'Warehouse district of red-brick blocks, canals, and bridges.',
        discoveryContext: 'Appears as a landmark marker when the warehouse blocks are revealed.',
        cell: '2-4',
        x: 35,
        y: 55,
        latitude: 53.5436,
        longitude: 10.0014,
      },
      {
        id: 'market-arch',
        name: 'Fischmarkt',
        category: 'market',
        district: 'Market Ring',
        description: 'Traditional riverside market area by the Elbe.',
        discoveryContext: 'Appears when the route follows the western waterfront.',
        cell: '4-3',
        x: 62,
        y: 43,
        latitude: 53.54667,
        longitude: 9.9521,
      },
      {
        id: 'planten-un-blomen',
        name: 'Planten un Blomen',
        category: 'park',
        district: 'North Commons',
        description: 'Large central park with gardens, paths, and quiet green corners.',
        discoveryContext: 'Revealed as a quiet green marker north of the harbor walk.',
        cell: '5-2',
        x: 76,
        y: 31,
        latitude: 53.5617,
        longitude: 9.978,
      },
    ],
    map: {
      water: ['M0 646 C108 624 174 680 308 660 S514 630 700 684 L700 800 L0 800 Z'],
      parks: ['M498 224 C590 186 676 222 670 312 C664 390 580 420 520 370 C474 330 474 252 498 224 Z'],
      streetsMajor: [
        'M82 0 L110 148 L112 292 L82 452 L136 800',
        'M326 0 L306 182 L342 338 L322 532 L360 800',
        'M588 0 L548 160 L576 332 L548 524 L618 800',
        'M0 182 L174 164 L334 184 L510 164 L700 182',
        'M0 396 L180 368 L340 396 L518 366 L700 394',
        'M0 592 L188 620 L338 594 L526 620 L700 590',
      ],
      streetsMinor: ['M220 0 L210 800', 'M458 0 L438 800', 'M0 286 L700 286', 'M0 494 L700 486'],
      regions: [
        {
          id: 'harbor',
          name: 'Harbor Edge',
          d: 'M0 498 L188 466 L286 530 L266 800 L0 800 Z',
          labelX: 106,
          labelY: 658,
        },
        {
          id: 'warehouse',
          name: 'Warehouse Blocks',
          d: 'M0 164 L184 146 L226 428 L160 544 L0 534 Z',
          labelX: 108,
          labelY: 346,
        },
        {
          id: 'market',
          name: 'Market Ring',
          d: 'M220 188 L520 162 L536 438 L360 522 L222 444 Z',
          labelX: 352,
          labelY: 340,
        },
        {
          id: 'north',
          name: 'North Commons',
          d: 'M166 0 L700 0 L690 172 L520 184 L356 158 L206 176 Z',
          labelX: 418,
          labelY: 92,
        },
      ],
      labels: [
        { text: 'Alster Edge', x: 578, y: 744, tone: 'light' },
        { text: 'Market Ring', x: 354, y: 342, tone: 'dark' },
      ],
    },
  },
]

export const copyRules = {
  recommendedTerms: ['revealed', 'discovered', 'saved', 'walked', 'district', 'memory', 'place', 'private', 'real place'],
  avoidTerms: ['XP', 'leaderboard', 'ranking', 'top rated', 'best near you', 'optimize route', 'complete level', 'score'],
}
