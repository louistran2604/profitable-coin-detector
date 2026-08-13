'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../src/coin-detector-core');

const RATE = 0.10;
const GPU = core.DEFAULT_HARDWARE;
const CPU = core.normalizeHardwareEntry({
  name: 'AMD Ryzen 9 7900X',
  url: 'https://www.hashrate.no/cpus/7900x/',
});

function row({ coin = 'Alpha Coin', ticker = 'AAA', algorithm = 'AlgoA', hashrate = '10 Mh/s', power = 100, revenue, duplicateClass = '' }) {
  return `<li class="${duplicateClass}">
    <div class="name">${coin} ${ticker}</div>
    <div class="estimatesDescription">${algorithm}</div>
    <div class="estimates">${hashrate}</div>
    <div class="estimatesDescription">Power</div><div class="estimates">${power} w</div>
    <div class="estimatesDescription">Rev. 24h</div><div class="estimates">$${revenue}</div>
    <div>Profit 24h $999.99</div>
  </li>`;
}

function page(rows, hardware = GPU, title = `${hardware.name} | Hashrate`, metaTitle = hardware.name) {
  return `<html><head><title>${title}</title><meta name="title" content="${metaTitle}"></head><body><ul id="myUL">${rows.join('')}</ul></body></html>`;
}

function revenueForNet(net, power = 100) {
  return (net + power * 24 / 1000 * RATE).toFixed(4);
}

function coinRow(options) {
  return row({ ...options, revenue: options.revenue ?? revenueForNet(options.net, options.power) });
}

function run(hardware, html, state = core.createInitialState(), fetchedAt = '2026-08-10T01:15:00.000Z') {
  return core.processDeviceRun({ html, state, electricityRate: RATE, hardware, fetchedAt });
}

test('validates configurable GPU and CPU hardware URLs', () => {
  const config = core.parseHardwareConfigText(JSON.stringify({
    hardware: [
      { name: GPU.name, url: GPU.url },
      { name: CPU.name, url: CPU.url },
    ],
  }));
  assert.equal(config.ok, true);
  assert.deepEqual(config.hardware.map((hardware) => hardware.type), ['gpu', 'cpu']);
  assert.deepEqual(config.hardware.map((hardware) => hardware.key), ['gpu:5060ti', 'cpu:7900x']);
  assert.equal(core.parseHardwareUrl('http://www.hashrate.no/gpus/5060ti/').ok, false);
  assert.equal(core.parseHardwareUrl('https://example.com/gpus/5060ti/').ok, false);
  assert.equal(core.parseHardwareUrl('https://www.hashrate.no/cpus/7900x/?x=1').ok, false);
});

test('rejects missing, duplicate, and malformed hardware configuration entries', () => {
  const result = core.validateHardwareConfig({
    hardware: [
      { name: 'Same', url: 'https://www.hashrate.no/gpus/5060ti/' },
      { name: 'Same', url: 'https://www.hashrate.no/gpus/5060ti/' },
      { name: 'Broken', url: 'https://example.com/gpus/4070/' },
    ],
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate name')));
  assert.ok(result.errors.some((error) => error.includes('duplicate url')));
  assert.equal(core.validateHardwareConfig([]).ok, false);
});

test('matches each configured hardware page exactly', () => {
  const gpuHtml = page([coinRow({ ticker: 'AAA', net: 0.50 })]);
  assert.equal(core.parseSource(gpuHtml, GPU).ok, true);
  assert.equal(core.parseSource(page([coinRow({ ticker: 'AAA', net: 0.50 })], GPU, 'NVIDIA RTX 5060 Ti 8GB | Hashrate'), GPU).reason, 'wrong_hardware_title');

  const cpuHtml = page([coinRow({ ticker: 'CPU', net: 0.50 })], CPU);
  assert.equal(core.parseSource(cpuHtml, CPU).ok, true);
  assert.equal(core.parseSource(cpuHtml, GPU).reason, 'wrong_hardware_title');
});

test('uses Rev. 24h for net profit and calculates electricity efficiency', () => {
  const parsed = core.calculateSourceCoins(
    page([row({ ticker: 'AAA', power: 100, revenue: '1.24' })]),
    RATE,
    GPU.url,
    '2026-08-10T01:15:00.000Z',
    {},
    GPU,
  );
  assert.equal(parsed.coins.length, 1);
  assert.equal(parsed.coins[0].revenue24h, 1.24);
  assert.equal(parsed.coins[0].electricityCostPerDay, 0.24);
  assert.equal(parsed.coins[0].netProfit, 1);
  assert.equal(parsed.coins[0].profitPerKwh, 0.4166666666666667);
});

test('calculates hashrate efficiency in the source hashrate unit', () => {
  const coin = core.calculateCoin({
    coin: 'Pearl',
    ticker: 'PRL',
    algorithm: 'pearl-pow',
    hashrate: '80.87 Th/s',
    powerW: 109,
    revenue24h: 1.36,
  }, RATE, GPU.url, 'now');
  assert.equal(coin.hashratePerWattUnit, 'TH/s/W');
  assert.ok(Math.abs(coin.hashratePerWatt - (80.87 / 109)) < 1e-12);
  assert.equal(core.calculateHashrateEfficiency('not a hashrate', 109), null);
});

test('does not gate daily digests on the old $1.25 threshold', () => {
  for (const net of [1.24, 1.25, 1.26]) {
    const result = run(GPU, page([coinRow({ ticker: `N${String(net).replace('.', '')}`, net })]));
    assert.equal(result.ok, true);
    assert.ok(result.digestPayload);
  }
});

test('prefers an efficient coin when profit is close', () => {
  const coins = [
    core.calculateCoin({ coin: 'Low', ticker: 'LOW', algorithm: 'a', hashrate: '1 Mh/s', powerW: 120, revenue24h: 1.638 }, RATE, GPU.url, 'now'),
    core.calculateCoin({ coin: 'High', ticker: 'HIGH', algorithm: 'b', hashrate: '1 Mh/s', powerW: 200, revenue24h: 1.88 }, RATE, GPU.url, 'now'),
  ];
  const ranked = core.rankCoins(coins).ranked;
  assert.equal(ranked[0].ticker, 'LOW');
  assert.equal(ranked[0].netProfit.toFixed(2), '1.35');
});

test('prefers a major profit advantage over efficiency', () => {
  const coins = [
    core.calculateCoin({ coin: 'High', ticker: 'HIGH', algorithm: 'a', hashrate: '1 Mh/s', powerW: 200, revenue24h: 2.48 }, RATE, GPU.url, 'now'),
    core.calculateCoin({ coin: 'Low', ticker: 'LOW', algorithm: 'b', hashrate: '1 Mh/s', powerW: 100, revenue24h: 1.44 }, RATE, GPU.url, 'now'),
  ];
  assert.equal(core.rankCoins(coins).ranked[0].ticker, 'HIGH');
});

test('sends a digest every successful day, including unchanged results', () => {
  const html = page([coinRow({ ticker: 'AAA', net: 0.50 })]);
  const first = run(GPU, html);
  assert.equal(first.ok, true);
  assert.equal(first.digestPayload.content, undefined);
  assert.equal(first.digestPayload.embeds.length, 1);
  const embed = first.digestPayload.embeds[0];
  assert.equal(embed.title, undefined);
  assert.match(embed.description, /^Fetched: 2026-08-10 08:15 ICT profitable coins digest/);
  assert.match(embed.description, /Hardware: GPU • \*\*NVIDIA RTX 5060 Ti 16GB\*\*/);
  assert.match(embed.description, /Electricity rate: \$0\.10\/kWh/);
  assert.match(embed.description, /1\. \*\*Alpha Coin\*\* \(AAA\) • AlgoA/);
  assert.match(embed.description, /HASHRATE\nHashrate \(mining speed\): 10 Mh\/s/);
  assert.match(embed.description, /Efficiency \(hashrate per watt\): 0\.100 MH\/s\/W/);
  assert.match(embed.description, /POWER\nPower \(estimated draw\): 100 W/);
  assert.match(embed.description, /Energy use \(24h\): 2\.40 kWh/);
  assert.match(embed.description, /Electricity cost \(24h\): \$0\.24/);
  assert.match(embed.description, /INCOME\nRevenue \(24h, before electricity\): \$0\.74/);
  assert.match(embed.description, /Revenue efficiency \(24h revenue per kWh\): \$0\.31\/kWh/);
  assert.match(embed.description, /Net profit \(24h, after electricity\): \$0\.50/);
  assert.match(embed.description, /Efficiency \(net profit per kWh\): \$0\.21\/kWh/);
  assert.equal((embed.description.match(/\*\*/g) || []).length, 4);
  assert.equal((JSON.stringify(first.digestPayload).match(/\*\*/g) || []).length, 4);
  assert.doesNotMatch(JSON.stringify(first.digestPayload), /Events:/);

  const sent = core.completeDiscord(first.nextState, GPU.key, {
    success: true,
    sentAt: '2026-08-10T01:16:00.000Z',
    statusCode: 204,
  });
  const unchanged = run(GPU, html, sent, '2026-08-11T01:15:00.000Z');
  assert.equal(unchanged.ok, true);
  assert.ok(unchanged.digestPayload);
  assert.deepEqual(unchanged.ranked.map((coin) => coin.key), first.ranked.map((coin) => coin.key));
});

test('keeps GPU and CPU state separate and isolates a failed device', () => {
  const gpuHtml = page([coinRow({ ticker: 'GPU', net: 0.80 })], GPU);
  const cpuHtml = page([coinRow({ ticker: 'CPU', net: 0.60 })], CPU);
  const gpuFirst = run(GPU, gpuHtml);
  const cpuFirst = run(CPU, cpuHtml, gpuFirst.nextState);
  assert.equal(cpuFirst.ok, true);
  assert.match(gpuFirst.digestPayload.embeds[0].description, /Hardware: GPU • \*\*NVIDIA RTX 5060 Ti 16GB\*\*/);
  assert.match(cpuFirst.digestPayload.embeds[0].description, /Hardware: CPU • \*\*AMD Ryzen 9 7900X\*\*/);
  assert.notEqual(gpuFirst.digestPayload.embeds[0].description, cpuFirst.digestPayload.embeds[0].description);
  assert.deepEqual(Object.keys(cpuFirst.nextState.devices).sort(), ['cpu:7900x', 'gpu:5060ti']);

  const gpuFailure = run(GPU, '', cpuFirst.nextState, '2026-08-11T01:15:00.000Z');
  assert.equal(gpuFailure.ok, false);
  assert.equal(gpuFailure.sourceStatus, 'empty_source');
  assert.equal(gpuFailure.digestPayload, null);
  assert.deepEqual(gpuFailure.nextState.devices[GPU.key].previousRank, cpuFirst.nextState.devices[GPU.key].previousRank);
  assert.equal(gpuFailure.nextState.devices[GPU.key].lastSuccessfulFetchedAt, cpuFirst.nextState.devices[GPU.key].lastSuccessfulFetchedAt);
  assert.equal(gpuFailure.nextState.devices[GPU.key].lastError.reason, 'empty_source');

  const cpuSecond = run(CPU, cpuHtml, gpuFailure.nextState, '2026-08-11T01:15:01.000Z');
  assert.equal(cpuSecond.ok, true);
  assert.ok(cpuSecond.digestPayload);
  assert.equal(cpuSecond.nextState.devices[GPU.key].lastError.reason, 'empty_source');
  assert.equal(cpuSecond.nextState.devices[CPU.key].lastError, null);
});

test('records Discord delivery status for only the selected hardware', () => {
  const gpu = run(GPU, page([coinRow({ ticker: 'GPU', net: 0.80 })], GPU));
  const cpu = run(CPU, page([coinRow({ ticker: 'CPU', net: 0.60 })], CPU), gpu.nextState);
  const failed = core.completeDiscord(cpu.nextState, GPU.key, {
    success: false,
    sentAt: '2026-08-10T01:17:00.000Z',
    statusCode: 500,
    error: 'HTTP 500',
  });
  assert.equal(failed.devices[GPU.key].lastDiscord.success, false);
  assert.equal(failed.devices[GPU.key].lastDiscord.error, 'HTTP 500');
  assert.equal(failed.devices[CPU.key].lastDiscord, null);
});

test('migrates legacy single-device state into the configured device map', () => {
  const legacy = {
    previousValues: { 'AAA|algoa': { ticker: 'AAA', algorithm: 'AlgoA', revenue24h: 1 } },
    previousRank: ['AAA|algoa'],
    lastFetchedAt: '2026-08-10T01:15:00.000Z',
    lastSuccessfulFetchedAt: '2026-08-10T01:15:00.000Z',
  };
  const normalized = core.normalizeState(legacy, [GPU, CPU]);
  assert.equal(normalized.version, 2);
  assert.deepEqual(Object.keys(normalized.devices), [GPU.key]);
  assert.deepEqual(normalized.devices[GPU.key].previousRank, ['AAA|algoa']);
});

test('rejects malformed, empty, missing, and suspicious source data', () => {
  assert.equal(core.parseSource('').reason, 'empty_source');
  const malformed = page([
    row({ ticker: 'BAD1', power: 'N/A', revenue: '1.00' }),
    row({ ticker: 'BAD2', power: 100, revenue: 'N/A' }),
  ]);
  const malformedResult = core.calculateSourceCoins(malformed, RATE, GPU.url, '2026-08-10T01:15:00.000Z', {}, GPU);
  assert.equal(malformedResult.coins.length, 0);
  assert.ok(malformedResult.rejected.includes('invalid_power'));
  assert.ok(malformedResult.rejected.includes('invalid_revenue'));

  const mixed = page([
    row({ ticker: 'GOOD', power: 100, revenue: '1.00' }),
    row({ ticker: 'HIGHPOWER', power: 500, revenue: '1.00' }),
    row({ ticker: 'HIGHREVENUE', power: 100, revenue: '99.00' }),
  ]);
  const mixedResult = core.calculateSourceCoins(mixed, RATE, GPU.url, '2026-08-10T01:15:00.000Z', {}, GPU);
  assert.deepEqual(mixedResult.coins.map((coin) => coin.ticker), ['GOOD']);
  assert.equal(mixedResult.suspiciousCount, 2);
});

test('deduplicates ticker plus algorithm and excludes merged entries', () => {
  const duplicate = row({ coin: 'Alpha Coin', ticker: 'AAA', algorithm: 'AlgoA', power: 100, revenue: '1.00' });
  const betterDuplicate = row({ coin: 'Alpha Coin', ticker: 'AAA', algorithm: 'AlgoA', power: 90, revenue: '1.10' });
  const merged = row({ coin: 'Merged', ticker: 'PRL+MDL', algorithm: 'pearl-pow', power: 100, revenue: '2.00' });
  const parsed = core.calculateSourceCoins(page([duplicate, betterDuplicate, merged]), RATE, GPU.url, '2026-08-10T01:15:00.000Z', {}, GPU);
  assert.equal(parsed.coins.length, 1);
  assert.equal(parsed.coins[0].powerW, 90);
  assert.ok(parsed.rejected.includes('merged_entry'));
});

test('preserves the last good snapshot on parser collapse', () => {
  const initial = run(GPU, page([
    coinRow({ ticker: 'A', net: 0.50 }),
    coinRow({ ticker: 'B', net: 0.51 }),
    coinRow({ ticker: 'C', net: 0.52 }),
    coinRow({ ticker: 'D', net: 0.53 }),
  ]));
  const next = run(GPU, page([coinRow({ ticker: 'A', net: 0.50 })]), initial.nextState, '2026-08-11T01:15:00.000Z');
  assert.equal(next.ok, false);
  assert.equal(next.sourceStatus, 'parser_collapse');
  assert.deepEqual(next.nextState.devices[GPU.key].previousRank, initial.nextState.devices[GPU.key].previousRank);
  assert.equal(next.nextState.devices[GPU.key].lastSuccessfulFetchedAt, initial.nextState.devices[GPU.key].lastSuccessfulFetchedAt);
});

test('fails closed for invalid electricity rates', () => {
  const result = core.processDeviceRun({
    hardware: GPU,
    html: page([coinRow({ ticker: 'AAA', net: 0.50 })]),
    state: core.createInitialState(),
    electricityRate: 1e308,
    fetchedAt: '2026-08-10T01:15:00.000Z',
  });
  assert.equal(result.ok, false);
  assert.equal(result.sourceStatus, 'invalid_electricity_rate');
  assert.equal(result.digestPayload, null);
});

test('only initializes missing state and fails closed for other state-read errors', () => {
  const source = fs.readFileSync(require.resolve('../scripts/build-workflow.js'), 'utf8');
  const start = source.indexOf('function readState()');
  const end = source.indexOf('\n\nfunction writeState', start);
  const readState = source.slice(start, end);
  assert.match(readState, /if \(error\.code === 'ENOENT'\) return core\.createInitialState\(\);/);
  assert.match(readState, /throw error;/);
});
