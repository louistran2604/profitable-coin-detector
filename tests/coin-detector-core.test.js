'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../src/coin-detector-core');

const RATE = 0.10;
const SOURCE = core.SOURCE_URL;

function row({ coin = 'Alpha Coin', ticker = 'AAA', algorithm = 'AlgoA', hashrate = '10 Mh/s', power = 100, revenue, duplicateClass = '' }) {
  return `<li class="${duplicateClass}">
    <div class="name">${coin} <span>${ticker}</span></div>
    <div class="estimatesDescription">${algorithm}</div>
    <div class="estimates">${hashrate}</div>
    <div class="estimatesDescription">Power</div><div class="estimates">${power} w</div>
    <div class="estimatesDescription">Rev. 24h</div><div class="estimates">$${revenue}</div>
    <div>Profit 24h $999.99</div>
  </li>`;
}

function page(rows, title = 'NVIDIA RTX 5060 Ti 16GB | Hashrate', metaTitle = 'NVIDIA RTX 5060 Ti 16GB') {
  return `<html><head><title>${title}</title><meta name="title" content="${metaTitle}"></head><body><ul id="myUL">${rows.join('')}</ul></body></html>`;
}

function revenueForNet(net, power = 100) {
  return (net + power * 24 / 1000 * RATE).toFixed(4);
}

function coinRow(options) {
  return row({ ...options, revenue: options.revenue ?? revenueForNet(options.net, options.power) });
}

function run(html, state = core.createInitialState(), fetchedAt = '2026-08-10T01:15:00.000Z', discordWebhookUrl = 'https://discord.example/webhook') {
  return core.processRun({ html, state, electricityRate: RATE, source: SOURCE, fetchedAt, discordWebhookUrl });
}

function send(result, sentAt = '2026-08-10T01:16:00.000Z') {
  return core.completeDiscord(result.nextState, { success: true, sentAt });
}

function workflow() {
  return JSON.parse(fs.readFileSync(require.resolve('../workflows/coin-profitability-detector.json'), 'utf8'));
}

test('accepts the exact GPU marker and rejects 8GB or other GPU pages', () => {
  const good = page([coinRow({ ticker: 'AAA', net: 0.50 })]);
  assert.equal(core.parseSource(good).ok, true);
  assert.equal(core.parseSource(page([coinRow({ ticker: 'AAA', net: 0.50 })], 'NVIDIA RTX 5060 Ti 8GB | Hashrate')).reason, 'wrong_gpu_title');
  assert.equal(core.parseSource(page([coinRow({ ticker: 'AAA', net: 0.50 })], 'NVIDIA RTX 4070 | Hashrate')).reason, 'wrong_gpu_title');
  assert.equal(core.parseSource(page([coinRow({ ticker: 'AAA', net: 0.50 })], undefined, 'NVIDIA RTX 5060 Ti 8GB')).reason, 'wrong_gpu_meta_title');
});

test('uses rolling Rev. 24h rather than displayed Profit 24h', () => {
  const parsed = core.calculateSourceCoins(page([row({ ticker: 'AAA', power: 100, revenue: '1.24' })]), RATE, SOURCE, '2026-08-10T01:15:00.000Z');
  assert.equal(parsed.coins.length, 1);
  assert.equal(parsed.coins[0].revenue24h, 1.24);
  assert.equal(parsed.coins[0].netProfit, 1.00);
});

test('classifies the exact $1.24/$1.25/$1.26 threshold', () => {
  assert.equal(core.thresholdClassification(1.24), 'below_1.25');
  assert.equal(core.thresholdClassification(1.25), 'at_or_above_1.25');
  assert.equal(core.thresholdClassification(1.26), 'at_or_above_1.25');
  assert.equal(core.isThresholdMet(1.25), true);
});

test('prefers $1.35 at 120W over $1.40 at 200W', () => {
  const coins = [
    core.calculateCoin({ coin: 'Low', ticker: 'LOW', algorithm: 'a', hashrate: '1 Mh/s', powerW: 120, revenue24h: 1.638 }, RATE, SOURCE, 'now'),
    core.calculateCoin({ coin: 'High', ticker: 'HIGH', algorithm: 'b', hashrate: '1 Mh/s', powerW: 200, revenue24h: 1.88 }, RATE, SOURCE, 'now'),
  ];
  const ranked = core.rankCoins(coins).ranked;
  assert.equal(ranked[0].netProfit.toFixed(2), '1.35');
  assert.equal(ranked[0].ticker, 'LOW');
});

test('prefers $2.00 at 200W over $1.20 at 100W when they are not competitive', () => {
  const coins = [
    core.calculateCoin({ coin: 'High', ticker: 'HIGH', algorithm: 'a', hashrate: '1 Mh/s', powerW: 200, revenue24h: 2.48 }, RATE, SOURCE, 'now'),
    core.calculateCoin({ coin: 'Low', ticker: 'LOW', algorithm: 'b', hashrate: '1 Mh/s', powerW: 100, revenue24h: 1.44 }, RATE, SOURCE, 'now'),
  ];
  assert.equal(core.rankCoins(coins).ranked[0].ticker, 'HIGH');
});

test('stages an efficient-alternative event and includes the raw leader in the digest', () => {
  const html = page([
    coinRow({ ticker: 'LOW', net: 1.35, power: 120 }),
    coinRow({ ticker: 'HIGH', net: 1.40, power: 200 }),
  ]);
  const result = run(html);
  assert.ok(result.events.some((item) => item.type === 'efficient_alternative'));
  assert.match(result.pendingDiscordAlert.payload.content, /Raw-profit leader: Alpha Coin/);
  assert.match(result.pendingDiscordAlert.payload.content, /Source: https:\/\/www\.hashrate\.no\/gpus\/5060ti\//);
  assert.match(result.pendingDiscordAlert.payload.content, /Fetched: .* ICT/);
  const unchanged = run(html, send(result), '2026-08-11T01:15:00.000Z');
  assert.deepEqual(unchanged.events, []);
  assert.equal(unchanged.nextState.pendingDiscordAlert, null);
  assert.equal(unchanged.shouldPostDiscord, false);
});

test('deduplicates ticker plus algorithm and excludes merged entries', () => {
  const duplicate = row({ coin: 'Alpha Coin', ticker: 'AAA', algorithm: 'AlgoA', power: 100, revenue: '1.00' });
  const betterDuplicate = row({ coin: 'Alpha Coin', ticker: 'AAA', algorithm: 'AlgoA', power: 90, revenue: '1.10' });
  const merged = row({ coin: 'Merged', ticker: 'PRL+MDL', algorithm: 'pearl-pow', power: 100, revenue: '2.00' });
  const parsed = core.calculateSourceCoins(page([duplicate, betterDuplicate, merged]), RATE, SOURCE, '2026-08-10T01:15:00.000Z');
  assert.equal(parsed.coins.length, 1);
  assert.equal(parsed.coins[0].powerW, 90);
  assert.ok(parsed.rejected.includes('merged_entry'));
});

test('excludes malformed, empty, missing, and suspicious source data', () => {
  assert.equal(core.parseSource('').reason, 'empty_source');
  const malformed = page([
    row({ ticker: 'BAD1', power: 'N/A', revenue: '1.00' }),
    row({ ticker: 'BAD2', power: 100, revenue: 'N/A' }),
  ]);
  const malformedResult = core.calculateSourceCoins(malformed, RATE, SOURCE, '2026-08-10T01:15:00.000Z');
  assert.equal(malformedResult.coins.length, 0);
  assert.ok(malformedResult.rejected.includes('invalid_power'));
  assert.ok(malformedResult.rejected.includes('invalid_revenue'));
  const spike = core.calculateSourceCoins(page([row({ ticker: 'SPIKE', power: 2000, revenue: '1.00' })]), RATE, SOURCE, '2026-08-10T01:15:00.000Z');
  assert.equal(spike.coins.length, 0);
  assert.equal(spike.suspiciousCount, 1);
  const mixed = page([
    row({ ticker: 'GOOD', power: 100, revenue: '1.00' }),
    row({ ticker: 'HIGHPOWER', power: 500, revenue: '1.00' }),
    row({ ticker: 'HIGHREVENUE', power: 100, revenue: '99.00' }),
  ]);
  const mixedResult = core.calculateSourceCoins(mixed, RATE, SOURCE, '2026-08-10T01:15:00.000Z');
  assert.deepEqual(mixedResult.coins.map((coin) => coin.ticker), ['GOOD']);
  assert.equal(mixedResult.suspiciousCount, 2);
  const mixedRun = run(mixed);
  assert.equal(mixedRun.ok, true);
  assert.deepEqual(mixedRun.coins.map((coin) => coin.ticker), ['GOOD']);
  const allSuspicious = run(page([
    row({ ticker: 'HIGHPOWER', power: 500, revenue: '1.00' }),
    row({ ticker: 'HIGHREVENUE', power: 100, revenue: '99.00' }),
  ]));
  assert.equal(allSuspicious.ok, false);
  assert.equal(allSuspicious.sourceStatus, 'no_valid_rows');
});

test('stages an initial useful digest once and suppresses unchanged duplicates', () => {
  const html = page([coinRow({ ticker: 'AAA', net: 0.50 })]);
  const first = run(html);
  assert.equal(first.ok, true);
  assert.ok(first.events.some((item) => item.type === 'initial_digest'));
  assert.ok(first.nextState.pendingDiscordAlert);
  const sentState = send(first);
  const unchanged = run(html, sentState, '2026-08-11T01:15:00.000Z');
  assert.deepEqual(unchanged.events, []);
  assert.equal(unchanged.nextState.pendingDiscordAlert, null);
  assert.equal(unchanged.shouldPostDiscord, false);
});

test('detects a new competitive coin and exact threshold crossing', () => {
  const first = run(page([coinRow({ ticker: 'AAA', net: 1.24 })]));
  const stateAfterFirst = send(first);
  const withNew = run(page([
    coinRow({ ticker: 'AAA', net: 1.25 }),
    coinRow({ ticker: 'BBB', net: 1.26, power: 105 }),
  ]), stateAfterFirst, '2026-08-11T01:15:00.000Z');
  assert.ok(withNew.events.some((item) => item.type === 'threshold_crossing' && item.key === 'AAA|algoa'));
  assert.ok(withNew.events.some((item) => item.type === 'new_competitive_coin' && item.key === 'BBB|algoa'));
});

test('detects significant profit and efficiency improvement', () => {
  const first = run(page([coinRow({ ticker: 'AAA', net: 0.50 })]));
  const stateAfterFirst = send(first);
  const improved = run(page([coinRow({ ticker: 'AAA', net: 0.70 })]), stateAfterFirst, '2026-08-11T01:15:00.000Z');
  assert.ok(improved.events.some((item) => item.type === 'profit_improvement'));
  assert.ok(improved.events.some((item) => item.type === 'efficiency_improvement'));
});

test('detects meaningful rank change and disappearance', () => {
  const first = run(page([
    coinRow({ ticker: 'AAA', net: 1.35, power: 120 }),
    coinRow({ ticker: 'BBB', net: 1.40, power: 200 }),
  ]));
  const stateAfterFirst = send(first);
  const rankChanged = run(page([
    coinRow({ ticker: 'AAA', net: 1.35, power: 120 }),
    coinRow({ ticker: 'BBB', net: 1.50, power: 200 }),
  ]), stateAfterFirst, '2026-08-11T01:15:00.000Z');
  assert.ok(rankChanged.events.some((item) => item.type === 'rank_change'));
  const stateAfterRankAlert = send(rankChanged, '2026-08-11T01:16:00.000Z');
  const disappeared = run(page([coinRow({ ticker: 'BBB', net: 1.50, power: 200 })]), stateAfterRankAlert, '2026-08-12T01:15:00.000Z');
  assert.ok(disappeared.events.some((item) => item.type === 'disappearance' && item.key === 'AAA|algoa'));
});

test('uses the unchanged-snapshot stale heuristic after 48 hours', () => {
  const html = page([coinRow({ ticker: 'AAA', net: 0.50 })]);
  const first = run(html);
  const stateAfterFirst = send(first);
  const stale = run(html, stateAfterFirst, '2026-08-12T02:00:01.000Z');
  assert.equal(stale.sourceStatus, 'stale');
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.events, []);
  assert.equal(stale.shouldPostDiscord, false);
});

test('preserves pending state and does not mark a failed Discord alert as sent', () => {
  const staged = run(page([coinRow({ ticker: 'AAA', net: 0.50 })]));
  const failed = core.completeDiscord(staged.nextState, {
    success: false,
    sentAt: '2026-08-10T01:17:00.000Z',
    error: 'HTTP 500',
  });
  assert.equal(failed.lastAlert, null);
  assert.ok(failed.pendingDiscordAlert);
  assert.equal(failed.lastDiscordError.error, 'HTTP 500');
  const retry = run(page([coinRow({ ticker: 'AAA', net: 0.50 })]), failed, '2026-08-11T01:15:00.000Z');
  assert.equal(retry.shouldPostDiscord, true);
  const success = core.completeDiscord(retry.nextState, { success: true, sentAt: '2026-08-11T01:16:00.000Z' });
  assert.equal(success.pendingDiscordAlert, null);
  assert.ok(success.lastAlert);
});

test('source failures preserve profitability state and never request a fake alert', () => {
  const staged = run(page([coinRow({ ticker: 'AAA', net: 0.50 })]));
  const sentState = send(staged);
  const failure = run(null, sentState, '2026-08-11T01:15:00.000Z');
  assert.equal(failure.ok, false);
  assert.equal(failure.sourceStatus, 'empty_source');
  assert.equal(failure.shouldPostDiscord, false);
  assert.equal(failure.nextState.lastAlert.id, sentState.lastAlert.id);
  assert.deepEqual(failure.nextState.previousRank, sentState.previousRank);
});

test('rejects incomplete numeric values, caps the electricity rate, and rejects non-finite derived values', () => {
  const invalidPower = core.calculateSourceCoins(
    page([row({ ticker: 'JUNKPOWER', power: '100junk', revenue: '1.00' })]),
    RATE,
    SOURCE,
    '2026-08-10T01:15:00.000Z',
  );
  assert.equal(invalidPower.coins.length, 0);
  assert.ok(invalidPower.rejected.includes('invalid_power'));

  const invalidRevenue = core.calculateSourceCoins(
    page([row({ ticker: 'EXPONENT', power: 100, revenue: '1e309' })]),
    RATE,
    SOURCE,
    '2026-08-10T01:15:00.000Z',
  );
  assert.equal(invalidRevenue.coins.length, 0);
  assert.ok(invalidRevenue.rejected.includes('invalid_revenue'));

  const base = page([coinRow({ ticker: 'RATE', net: 0.50 })]);
  const atCap = core.processRun({
    html: base,
    state: core.createInitialState(),
    electricityRate: 10,
    source: SOURCE,
    fetchedAt: '2026-08-10T01:15:00.000Z',
  });
  assert.equal(atCap.ok, true);

  const aboveCap = core.processRun({
    html: base,
    state: core.createInitialState(),
    electricityRate: 1e308,
    source: SOURCE,
    fetchedAt: '2026-08-10T01:15:00.000Z',
  });
  assert.equal(aboveCap.ok, false);
  assert.equal(aboveCap.sourceStatus, 'invalid_electricity_rate');

  const tinyPower = `0.${'0'.repeat(323)}5`;
  const nonFiniteDerived = core.calculateSourceCoins(
    page([row({ ticker: 'TINY', power: tinyPower, revenue: '1.00' })]),
    RATE,
    SOURCE,
    '2026-08-10T01:15:00.000Z',
  );
  assert.equal(nonFiniteDerived.coins.length, 0);
  assert.ok(nonFiniteDerived.rejected.includes('non_finite_derived'));
});

test('rejects an abrupt accepted-set collapse below half and accepts the half-count boundary', () => {
  const initial = run(page([
    coinRow({ ticker: 'A', net: 0.50 }),
    coinRow({ ticker: 'B', net: 0.51 }),
    coinRow({ ticker: 'C', net: 0.52 }),
    coinRow({ ticker: 'D', net: 0.53 }),
  ]));
  const previousState = send(initial);

  const half = run(page([
    coinRow({ ticker: 'A', net: 0.50 }),
    coinRow({ ticker: 'B', net: 0.51 }),
  ]), previousState, '2026-08-11T01:15:00.000Z');
  assert.equal(half.ok, true);
  assert.equal(Object.keys(half.nextState.previousValues).length, 2);

  const belowHalf = run(page([coinRow({ ticker: 'A', net: 0.50 })]), previousState, '2026-08-11T01:15:00.000Z');
  assert.equal(belowHalf.ok, false);
  assert.equal(belowHalf.sourceStatus, 'parser_collapse');
  assert.deepEqual(belowHalf.nextState.previousValues, previousState.previousValues);
  assert.deepEqual(belowHalf.nextState.previousRank, previousState.previousRank);
  assert.equal(belowHalf.nextState.snapshotHash, previousState.snapshotHash);
  assert.equal(belowHalf.nextState.lastSuccessfulFetchedAt, previousState.lastSuccessfulFetchedAt);
});

test('uses the current IF schema, keeps the webhook secret out of Code output, and gates HTTP on configuration', () => {
  const currentWorkflow = workflow();
  const ifNode = currentWorkflow.nodes.find((node) => node.name === 'Should post Discord alert?');
  const httpNode = currentWorkflow.nodes.find((node) => node.name === 'Post Discord alert');
  const stageNode = currentWorkflow.nodes.find((node) => node.name === 'Stage alert');

  assert.deepEqual(ifNode.parameters.conditions.options, {
    caseSensitive: true,
    leftValue: '',
    typeValidation: 'strict',
    version: 2,
  });
  assert.equal(ifNode.parameters.conditions.combinator, 'and');
  assert.deepEqual(ifNode.parameters.conditions.conditions.map((condition) => ({
    leftValue: condition.leftValue,
    rightValue: condition.rightValue,
    operator: condition.operator,
  })), [
    {
      leftValue: '={{ $json.shouldPostDiscord }}',
      rightValue: true,
      operator: { type: 'boolean', operation: 'true' },
    },
    {
      leftValue: '={{ $json.discordConfigured }}',
      rightValue: true,
      operator: { type: 'boolean', operation: 'true' },
    },
  ]);
  assert.equal(httpNode.parameters.url, '={{ $env.DISCORD_WEBHOOK_URL }}');
  assert.match(stageNode.parameters.jsCode, /discordConfigured: Boolean\(\$env\.DISCORD_WEBHOOK_URL\)/);
  assert.doesNotMatch(stageNode.parameters.jsCode, /\bdiscordUrl\b/);
});

test('only initializes missing state and fails closed for other state-read errors', () => {
  const source = fs.readFileSync(require.resolve('../scripts/build-workflow.js'), 'utf8');
  const start = source.indexOf('function readState()');
  const end = source.indexOf('\n\nfunction writeState', start);
  const readState = source.slice(start, end);
  assert.match(readState, /if \(error\.code === 'ENOENT'\) return core\.createInitialState\(\);/);
  assert.match(readState, /throw error;/);
});

test('binds n8n to localhost and serializes production runs', () => {
  const compose = fs.readFileSync(require.resolve('../compose.yml'), 'utf8');
  assert.match(compose, /"127\.0\.0\.1:6789:5678"/);
  assert.match(compose, /N8N_CONCURRENCY_PRODUCTION_LIMIT:\s*1/);
});
