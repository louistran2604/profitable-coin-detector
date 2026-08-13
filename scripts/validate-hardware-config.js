'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/coin-detector-core');

const configPath = path.resolve(__dirname, '..', 'config', 'hardware.json');
const validation = core.parseHardwareConfigText(fs.readFileSync(configPath, 'utf8'));

if (!validation.ok) {
  console.error(`Invalid hardware configuration: ${validation.errors.join('; ')}`);
  process.exit(1);
}

for (const hardware of validation.hardware) {
  console.log(`${hardware.type.toUpperCase()}: ${hardware.name} (${hardware.url})`);
}
