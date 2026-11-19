'use strict';

// The one place that defines what a "project" can be. The server validates
// against it and sends it to the admin page, so the two can never disagree.

const CLASSES = {
  Mods: [
    'Adventure and RPG', 'API and Library', 'Armor, Tools, and Weapons', 'Cosmetic', 'Education',
    'Food', 'Magic', 'Map and Information', 'Miscellaneous', 'Mobs', 'Performance', 'Redstone',
    'Server Utility', 'Storage', 'Technology', 'Transportation', 'Utility & QoL', 'World Gen'
  ],
  Plugins: [
    'Admin Tools', 'Anti-Griefing Tools', 'Chat Related', 'Developer Tools', 'Economy', 'Fixes',
    'Fun', 'General', 'Informational', 'Mechanics', 'Miscellaneous', 'Role Playing', 'Teleportation',
    'World Editing and Management', 'World Generators'
  ],
  Modpacks: [
    'Adventure and RPG', 'Combat / PvP', 'Exploration', 'Extra Large', 'FTB Official Pack', 'Hardcore',
    'Magic', 'Map Based', 'Mini Game', 'Multiplayer', 'Quests', 'Sci-Fi', 'Skyblock', 'Small / Light',
    'Technology', 'Vanilla+'
  ],
  'Resource Packs': [
    '16x', '32x', '64x', '128x', '256x and Higher', 'Animated', 'Data Packs', 'Medieval', 'Miscellaneous',
    'Modern', 'Mod Support', 'Photo Realistic', 'Steampunk', 'Traditional', 'Vanilla-like'
  ],
  'Data Packs': [
    'Adventure and RPG', 'Cosmetic', 'Magic', 'Miscellaneous', 'Mobs', 'Technology', 'Utility & QoL', 'World Gen'
  ],
  Shaders: [
    'Cartoon', 'Fantasy', 'Realistic', 'Semi-realistic', 'Vanilla-like', 'Performance', 'Miscellaneous'
  ]
};

// Name shown in the dropdown, and where "View full license" goes (none for
// All Rights Reserved, which is the right default for something you sell).
const LICENSES = [
  { name: 'All Rights Reserved', url: null },
  { name: 'MIT License', url: 'https://opensource.org/license/mit' },
  { name: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  { name: 'GNU GPLv3', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
  { name: 'GNU LGPLv3', url: 'https://www.gnu.org/licenses/lgpl-3.0.html' },
  { name: 'Mozilla Public License 2.0', url: 'https://www.mozilla.org/en-US/MPL/2.0/' },
  { name: 'BSD 3-Clause', url: 'https://opensource.org/license/bsd-3-clause' },
  { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
  { name: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/' },
  { name: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' },
  { name: 'CC0 (Public Domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
];

const LINK_TYPES = [
  'Website', 'Discord', 'YouTube', 'TikTok', 'Ko-fi', 'Patreon', 'Twitter / X', 'Instagram',
  'GitHub', 'Modrinth', 'CurseForge'
];

const LIMITS = {
  name: 128,
  summary: 256,
  description: 20000,
  extraCategories: 5,
  links: 8
};

// Options for uploaded files (CurseForge-style "Upload New File").
// To offer a new Minecraft version, add it to the top of GAME_VERSIONS.
const ENVIRONMENTS = ['Client', 'Server'];
const MODLOADERS = ['Fabric', 'Forge', 'NeoForge', 'Quilt', 'Bukkit', 'Spigot', 'Paper', 'Purpur', 'Folia'];
const JAVA_VERSIONS = ['Java 25', 'Java 21', 'Java 17', 'Java 16', 'Java 8'];
const RELEASE_TYPES = ['release', 'beta', 'alpha'];
// 1.21.11 down to 1.21 (the first release of a series has no patch number).
const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => (to - i === 0 ? prefix : `${prefix}.${to - i}`));
const GAME_VERSIONS = [
  '26.3', '26.2', '26.1.2', '26.1.1', '26.1',
  ...range('1.21', 0, 11),
  ...range('1.20', 0, 6),
  ...range('1.19', 0, 4),
  ...range('1.18', 0, 2),
  '1.17.1', '1.17', '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1', '1.16'
];

const FILE_LIMITS = { displayName: 128, changelog: 20000, dependencies: 20 };

const DEFAULT_LICENSE = 'All Rights Reserved';

const licenseByName = (name) => LICENSES.find((l) => l.name === name) || null;

// The older "Mod / Plugin" column is kept (it has a CHECK constraint that SQLite
// cannot drop), so it is filled in from the class.
const legacyCategory = (className) => (className === 'Plugins' ? 'Plugin' : 'Mod');

module.exports = {
  ENVIRONMENTS, MODLOADERS, JAVA_VERSIONS, RELEASE_TYPES, GAME_VERSIONS, FILE_LIMITS,
  CLASSES, LICENSES, LINK_TYPES, LIMITS, DEFAULT_LICENSE, licenseByName, legacyCategory };
