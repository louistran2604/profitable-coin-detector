'use strict';

const SOURCE_URL = 'https://www.hashrate.no/gpus/5060ti/';
const EXPECTED_GPU = 'NVIDIA RTX 5060 Ti 16GB';
const ICT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const ALERT_THRESHOLD_USD = 1.25;
const COMPETITIVE_GAP_USD = 0.10;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const MAX_POWER_W = 400;
const MAX_REVENUE_24H_USD = 20;
const MAX_ELECTRICITY_PRICE_PER_KWH = 10;
const SIGNIFICANT_PROFIT_DELTA_USD = 0.10;
const SIGNIFICANT_PROFIT_RELATIVE = 0.20;
const SIGNIFICANT_EFFICIENCY_DELTA = 0.02;
const SIGNIFICANT_EFFICIENCY_RELATIVE = 0.25;

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(parseInt(digits, 16)));
}

function stripTags(value) {
  return normalizeWhitespace(decodeEntities(String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classHasToken(attributes, className) {
  const match = attributes.match(/\bclass\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!match) return false;
  return match[2].split(/\s+/).includes(className);
}

function elementsWithClass(html, tag, className) {
  const result = [];
  const openTag = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  let match;
  while ((match = openTag.exec(html))) {
    if (!classHasToken(match[0], className)) continue;
    const closeTag = new RegExp(`</${tag}>`, 'gi');
    closeTag.lastIndex = openTag.lastIndex;
    const close = closeTag.exec(html);
    if (!close) continue;
    result.push({
      attributes: match[0],
      inner: html.slice(openTag.lastIndex, close.index),
    });
  }
  return result;
}

function firstElementText(html, tag, className) {
  const element = elementsWithClass(html, tag, className)[0];
  return element ? stripTags(element.inner) : '';
}

function extractAttribute(html, name) {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
  const match = String(html).match(pattern);
  return match ? decodeEntities(match[2]).trim() : '';
}

function extractFirstTag(html, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, 'i');
  const match = String(html).match(pattern);
  return match ? match[0] : '';
}

function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim();
  if (!text || /^(?:n\/a|na|null|undefined)$/i.test(text)) return null;
  const match = text.match(/^\$?\s*(-?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?)\s*w?$/i);
  if (!match) return null;
  const number = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function extractDataValue(row, names) {
  for (const name of names) {
    const value = extractAttribute(row, name);
    if (value) return value;
  }
  return '';
}

function extractAdjacentValue(row, label) {
  const escapedLabel = escapeRegExp(label);
  const pattern = new RegExp(
    `<[^>]*class\\s*=\\s*(["'])[^"']*\\bestimatesDescription\\b[^"']*\\1[^>]*>\\s*${escapedLabel}\\s*<\\/[^>]+>\\s*<[^>]*class\\s*=\\s*(["'])[^"']*\\bestimates\\b[^"']*\\2[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'i',
  );
  const match = String(row).match(pattern);
  return match ? stripTags(match[3]) : '';
}

function extractDirectListItems(html) {
  const openList = /<ul\b[^>]*\bid\s*=\s*(["'])myUL\1[^>]*>/i.exec(String(html));
  if (!openList) return [];

  const listStart = openList.index + openList[0].length;
  const tags = /<!--(?:[\s\S]*?)-->|<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  tags.lastIndex = listStart;
  let listDepth = 1;
  let itemDepth = 0;
  let itemStart = null;
  const items = [];
  let tag;

  while ((tag = tags.exec(String(html)))) {
    if (tag[0].startsWith('<!--')) continue;
    const name = tag[1].toLowerCase();
    const closing = /^<\//.test(tag[0]);
    const selfClosing = /\/\s*>$/.test(tag[0]);

    if (name === 'li') {
      if (!closing && !selfClosing) {
        if (listDepth === 1 && itemDepth === 0) itemStart = tags.lastIndex;
        itemDepth += 1;
      } else if (closing) {
        itemDepth = Math.max(0, itemDepth - 1);
        if (itemDepth === 0 && itemStart !== null) {
          items.push(String(html).slice(itemStart, tag.index));
          itemStart = null;
        }
      }
      continue;
    }

    if (name === 'ul' && !selfClosing) {
      if (closing) {
        listDepth -= 1;
        if (listDepth === 0) break;
      } else {
        listDepth += 1;
      }
    }
  }

  return items;
}

function exactGpuMarker(html) {
  const titleTag = extractFirstTag(html, 'title');
  const titleMatch = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const metaTags = String(html).match(/<meta\b[^>]*>/gi) || [];
  const metaTitleTag = metaTags.find((tag) => /\bname\s*=\s*(["'])title\1/i.test(tag));
  const metaTitle = metaTitleTag ? extractAttribute(metaTitleTag, 'content') : '';
  const expectedTitle = title === EXPECTED_GPU || title.startsWith(`${EXPECTED_GPU} |`);
  const expectedMeta = !metaTitle || metaTitle === EXPECTED_GPU;

  return {
    ok: Boolean(titleTag && expectedTitle && expectedMeta),
    title,
    metaTitle,
    reason: !titleTag ? 'missing_title' : !expectedTitle ? 'wrong_gpu_title' : !expectedMeta ? 'wrong_gpu_meta_title' : '',
  };
}

function stableKey(ticker, algorithm) {
  return `${normalizeWhitespace(ticker).toUpperCase()}|${normalizeWhitespace(algorithm).toLowerCase()}`;
}

function parseRow(row) {
  const plainText = stripTags(row);
  if (/\bmerged\b/i.test(plainText) || /\b[A-Z0-9]{2,}\s*\+\s*[A-Z0-9]{2,}\b/.test(plainText)) {
    return { valid: false, reason: 'merged_entry' };
  }

  const nameText = firstElementText(row, 'div', 'name');
  const nameParts = nameText.split(/\s+/).filter(Boolean);
  const hiddenText = firstElementText(row, 'span', 'hidden-search');
  const hiddenParts = hiddenText.split(/\s+/).filter(Boolean);
  const dataCoin = extractDataValue(row, ['data-coin', 'data-name']);
  const dataTicker = extractDataValue(row, ['data-ticker', 'data-symbol']);
  const dataAlgorithm = extractDataValue(row, ['data-algorithm', 'data-algo']);
  const dataHashrate = extractDataValue(row, ['data-hashrate']);
  const dataPower = extractDataValue(row, ['data-power-w', 'data-power']);
  const dataRevenue = extractDataValue(row, ['data-revenue-24h', 'data-revenue24h', 'data-revenue']);

  const ticker = dataTicker || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : hiddenParts[1] || '');
  const coin = dataCoin || (nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : hiddenParts[0] || '');
  const descriptions = elementsWithClass(row, 'div', 'estimatesDescription').map((element) => stripTags(element.inner));
  const algorithm = dataAlgorithm || descriptions[0] || hiddenParts.slice(2).join(' ');
  const estimateTexts = elementsWithClass(row, 'div', 'estimates').map((element) => stripTags(element.inner));
  const hashrate = dataHashrate || estimateTexts.find((value) => /\b(?:\d[\d.,]*\s*(?:[kMGTPE]?h\/s|[kMGTPE]?sol\/s))\b/i.test(value) && !/\/W\b/i.test(value)) ||
    plainText.match(/\b\d[\d.,]*\s*(?:[kMGTPE]?h\/s|[kMGTPE]?sol\/s)\b/i)?.[0] || '';
  const powerText = dataPower || extractAdjacentValue(row, 'Power') || plainText.match(/\bPower\s+(-?\d[\d.,]*)\s*w\b/i)?.[1] || '';
  const revenueText = dataRevenue || extractAdjacentValue(row, 'Rev. 24h') || plainText.match(/\bRev\.?\s*24h\s*\$?\s*(-?\d[\d.,]*)/i)?.[1] || '';
  const powerW = parseNumber(powerText);
  const revenue24h = parseNumber(revenueText);

  if (!coin || !ticker || !algorithm || !hashrate) return { valid: false, reason: 'missing_identity' };
  if (powerW === null || powerW <= 0) return { valid: false, reason: 'invalid_power' };
  if (revenue24h === null || revenue24h < 0) return { valid: false, reason: 'invalid_revenue' };

  return {
    valid: true,
    coin: normalizeWhitespace(coin),
    ticker: normalizeWhitespace(ticker),
    algorithm: normalizeWhitespace(algorithm),
    hashrate: normalizeWhitespace(hashrate),
    powerW,
    revenue24h,
  };
}

function parseSource(html) {
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, reason: 'empty_source', rows: [], rejected: [] };
  }
  const marker = exactGpuMarker(html);
  if (!marker.ok) return { ok: false, reason: marker.reason, rows: [], rejected: [] };

  const listItems = extractDirectListItems(html);
  if (!listItems.length) return { ok: false, reason: 'missing_estimate_rows', rows: [], rejected: [] };

  const rows = [];
  const rejected = [];
  for (const item of listItems) {
    const parsed = parseRow(item);
    if (parsed.valid) rows.push(parsed);
    else rejected.push(parsed.reason);
  }
  return { ok: true, reason: '', rows, rejected };
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function snapshotHash(coins) {
  const signature = coins.slice().sort((a, b) => a.key.localeCompare(b.key)).map((coin) => [
    coin.key,
    coin.coin,
    coin.hashrate,
    coin.powerW,
    coin.revenue24h,
  ]);
  return hashString(JSON.stringify(signature));
}

function suspiciousSpike(raw, previousValues) {
  if (raw.powerW > MAX_POWER_W || raw.revenue24h > MAX_REVENUE_24H_USD) return true;
  const previous = previousValues?.[stableKey(raw.ticker, raw.algorithm)];
  if (!previous || !Number.isFinite(previous.revenue24h)) return false;
  return raw.revenue24h > 10 && raw.revenue24h > previous.revenue24h * 10 && raw.revenue24h > previous.revenue24h + 5;
}

function calculateCoin(raw, electricityRate, source, fetchedAt) {
  const energyKwhPerDay = raw.powerW * 24 / 1000;
  const electricityCostPerDay = energyKwhPerDay * electricityRate;
  const netProfit = raw.revenue24h - electricityCostPerDay;
  const profitPerWatt = netProfit / raw.powerW;
  const profitPerKwh = netProfit / energyKwhPerDay;
  if ([energyKwhPerDay, electricityCostPerDay, netProfit, profitPerWatt, profitPerKwh].some((value) => !Number.isFinite(value))) {
    return null;
  }
  const coin = {
    coin: raw.coin,
    ticker: raw.ticker,
    algorithm: raw.algorithm,
    hashrate: raw.hashrate,
    powerW: raw.powerW,
    power: raw.powerW,
    revenue24h: raw.revenue24h,
    revenue_24h: raw.revenue24h,
    revenue: raw.revenue24h,
    energyKwhPerDay,
    energy_kwh_per_day: energyKwhPerDay,
    energyKwh: energyKwhPerDay,
    electricityCostPerDay,
    electricity_cost_per_day: electricityCostPerDay,
    electricityCost: electricityCostPerDay,
    netProfit,
    net_profit: netProfit,
    profitPerWatt,
    profit_per_watt: profitPerWatt,
    profitPerKwh,
    profit_per_kwh: profitPerKwh,
    thresholdMet: isThresholdMet(netProfit),
    source,
    fetchedAt,
    key: stableKey(raw.ticker, raw.algorithm),
  };
  return coin;
}

function deduplicateCoins(coins) {
  const byKey = new Map();
  for (const coin of coins) {
    const previous = byKey.get(coin.key);
    if (!previous || coin.revenue24h > previous.revenue24h || (coin.revenue24h === previous.revenue24h && coin.powerW < previous.powerW)) {
      byKey.set(coin.key, coin);
    }
  }
  return [...byKey.values()];
}

function calculateSourceCoins(html, electricityRate, source, fetchedAt, previousValues = {}) {
  const parsed = parseSource(html);
  if (!parsed.ok) return { ...parsed, coins: [], suspiciousCount: 0 };
  if (!Number.isFinite(electricityRate) || electricityRate < 0 || electricityRate > MAX_ELECTRICITY_PRICE_PER_KWH) {
    return { ok: false, reason: 'invalid_electricity_rate', rows: [], rejected: parsed.rejected, coins: [], suspiciousCount: 0 };
  }

  const coins = [];
  const rejected = [...parsed.rejected];
  let suspiciousCount = 0;
  for (const row of parsed.rows) {
    if (suspiciousSpike(row, previousValues)) {
      rejected.push('suspicious_spike');
      suspiciousCount += 1;
      continue;
    }
    const coin = calculateCoin(row, electricityRate, source, fetchedAt);
    if (!coin) {
      rejected.push('non_finite_derived');
      suspiciousCount += 1;
      continue;
    }
    coins.push(coin);
  }
  return {
    ok: true,
    reason: '',
    rows: parsed.rows,
    rejected,
    coins: deduplicateCoins(coins),
    suspiciousCount,
  };
}

function rankCoins(coins) {
  if (!coins.length) return { ranked: [], rawLeader: null, maxRawNetProfit: null, baselinePowerW: null };
  const maxRawNetProfit = Math.max(...coins.map((coin) => coin.netProfit));
  const competitive = coins.filter((coin) => coin.netProfit >= maxRawNetProfit - COMPETITIVE_GAP_USD);
  const baselinePowerW = Math.min(...competitive.map((coin) => coin.powerW));
  const ranked = coins.map((coin) => {
    const penalty = Math.min(COMPETITIVE_GAP_USD, Math.max(0, coin.powerW - baselinePowerW) * 0.001);
    return {
      ...coin,
      competitive: coin.netProfit >= maxRawNetProfit - COMPETITIVE_GAP_USD,
      penalty,
      score: coin.netProfit - penalty,
    };
  }).sort((a, b) => b.score - a.score || b.netProfit - a.netProfit || a.powerW - b.powerW || a.key.localeCompare(b.key));
  return {
    ranked: ranked.map((coin, index) => ({ ...coin, rank: index + 1 })),
    rawLeader: coins.slice().sort((a, b) => b.netProfit - a.netProfit || a.powerW - b.powerW || a.key.localeCompare(b.key))[0],
    maxRawNetProfit,
    baselinePowerW,
  };
}

function isThresholdMet(netProfit) {
  return Number.isFinite(netProfit) && netProfit >= ALERT_THRESHOLD_USD;
}

function thresholdClassification(netProfit) {
  if (!Number.isFinite(netProfit)) return 'invalid';
  return isThresholdMet(netProfit) ? 'at_or_above_1.25' : 'below_1.25';
}

function hasSignificantIncrease(current, previous, absoluteDelta, relativeDelta) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return false;
  const delta = current - previous;
  return delta > 0 && (delta >= absoluteDelta || (previous > 0 && delta / previous >= relativeDelta));
}

function meaningfulRankChange(previousRank, currentRank) {
  if (!previousRank?.length || !currentRank?.length) return false;
  if (previousRank[0] !== currentRank[0]) return true;
  const previousTop = previousRank.slice(0, 3);
  const currentTop = currentRank.slice(0, 3);
  if (previousTop.some((key) => !currentTop.includes(key)) || currentTop.some((key) => !previousTop.includes(key))) return true;
  return previousTop.some((key) => {
    const oldIndex = previousRank.indexOf(key);
    const newIndex = currentRank.indexOf(key);
    return newIndex >= 0 && Math.abs(oldIndex - newIndex) >= 1;
  });
}

function parserCollapse(previousValues, currentCoins) {
  const previousCount = Object.keys(previousValues || {}).length;
  return previousCount >= 4 && currentCoins.length * 2 < previousCount;
}

function createInitialState() {
  return {
    version: 1,
    lastFetchedAt: null,
    lastSuccessfulFetchedAt: null,
    lastChangedAt: null,
    lastRate: null,
    snapshotHash: null,
    previousValues: {},
    previousRank: [],
    seenCoins: {},
    lastAlert: null,
    pendingDiscordAlert: null,
    pendingEvents: [],
    lastDiscordError: null,
    lastError: null,
  };
}

function normalizeState(state) {
  const initial = createInitialState();
  const value = state && typeof state === 'object' ? state : {};
  return {
    ...initial,
    ...value,
    previousValues: value.previousValues && typeof value.previousValues === 'object' ? value.previousValues : {},
    previousRank: Array.isArray(value.previousRank) ? value.previousRank : [],
    seenCoins: value.seenCoins && typeof value.seenCoins === 'object' ? value.seenCoins : {},
    pendingEvents: Array.isArray(value.pendingEvents) ? value.pendingEvents : [],
  };
}

function event(type, key, coin) {
  return {
    id: `${type}:${key || 'gpu'}`,
    type,
    key: key || null,
    coin: coin?.coin || null,
    ticker: coin?.ticker || null,
  };
}

function detectEvents(state, rankedResult) {
  const { ranked, rawLeader } = rankedResult;
  const previousValues = state.previousValues || {};
  const currentByKey = Object.fromEntries(ranked.map((coin) => [coin.key, coin]));
  const events = [];
  const add = (value) => {
    if (!events.some((existing) => existing.id === value.id)) events.push(value);
  };

  if (!state.lastAlert && !state.pendingDiscordAlert && ranked.length) add(event('initial_digest'));
  for (const coin of ranked) {
    const seen = state.seenCoins?.[coin.key];
    if (coin.competitive && (!seen || !seen.competitive)) add(event('new_competitive_coin', coin.key, coin));
    const previous = previousValues[coin.key];
    if (!previous) continue;
    if (!isThresholdMet(previous.netProfit) && isThresholdMet(coin.netProfit)) add(event('threshold_crossing', coin.key, coin));
    if (hasSignificantIncrease(coin.netProfit, previous.netProfit, SIGNIFICANT_PROFIT_DELTA_USD, SIGNIFICANT_PROFIT_RELATIVE)) {
      add(event('profit_improvement', coin.key, coin));
    }
    if (hasSignificantIncrease(coin.profitPerKwh, previous.profitPerKwh, SIGNIFICANT_EFFICIENCY_DELTA, SIGNIFICANT_EFFICIENCY_RELATIVE)) {
      add(event('efficiency_improvement', coin.key, coin));
    }
  }

  const currentRank = ranked.map((coin) => coin.key);
  if (meaningfulRankChange(state.previousRank, currentRank)) add(event('rank_change'));
  for (const key of Object.keys(previousValues)) {
    if (!currentByKey[key]) add(event('disappearance', key, previousValues[key]));
  }
  if (ranked.length && rawLeader && ranked[0].key !== rawLeader.key && ranked[0].powerW < rawLeader.powerW &&
      (!state.previousRank.length || state.previousRank[0] !== ranked[0].key)) {
    add(event('efficient_alternative', ranked[0].key, ranked[0]));
  }
  return events;
}

function formatUsd(value) {
  return `$${Number(value).toFixed(2)}`;
}

function formatIct(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return String(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ICT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ICT`;
}

function coinLine(coin) {
  return `${coin.rank}. ${coin.coin} (${coin.ticker}/${coin.algorithm}) ${formatUsd(coin.netProfit)} net | ${coin.powerW}W | ${formatUsd(coin.profitPerKwh)}/kWh`;
}

function buildDiscordPayload(rankedResult, events, electricityRate, source, fetchedAt) {
  const top = rankedResult.ranked.slice(0, 3);
  const rawLeader = rankedResult.rawLeader;
  const lines = [
    `${EXPECTED_GPU} profitability digest`,
    `Electricity: ${formatUsd(electricityRate)}/kWh`,
    `Events: ${events.map((item) => item.type).join(', ') || 'none'}`,
    '',
    ...top.map(coinLine),
  ];
  if (rawLeader && (!top[0] || rawLeader.key !== top[0].key)) lines.push(`Raw-profit leader: ${rawLeader.coin} (${rawLeader.ticker}/${rawLeader.algorithm}) ${formatUsd(rawLeader.netProfit)} net | ${rawLeader.powerW}W`);
  lines.push('', `Source: ${source}`, `Fetched: ${formatIct(fetchedAt)}`);
  return {
    content: lines.join('\n'),
    allowed_mentions: { parse: [] },
  };
}

function mergeEvents(existing, additions) {
  const result = [...(existing || [])];
  for (const addition of additions || []) {
    if (!result.some((item) => item.id === addition.id)) result.push(addition);
  }
  return result;
}

function validTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function failedRun(state, timestamp, reason, rejected = []) {
  const nextState = {
    ...state,
    lastFetchedAt: timestamp,
    lastError: { at: timestamp, reason, rejected },
  };
  return {
    ok: false,
    sourceStatus: reason,
    stale: false,
    coins: [],
    ranked: [],
    rawLeader: null,
    events: [],
    pendingDiscordAlert: nextState.pendingDiscordAlert,
    shouldPostDiscord: false,
    nextState,
    error: reason,
  };
}

function processRun({ html, state, electricityRate, source = SOURCE_URL, fetchedAt = new Date().toISOString(), discordWebhookUrl = '' }) {
  const currentState = normalizeState(state);
  const timestamp = validTimestamp(fetchedAt);
  if (!timestamp) return failedRun(currentState, new Date().toISOString(), 'invalid_fetched_at');
  if (!Number.isFinite(electricityRate) || electricityRate < 0 || electricityRate > MAX_ELECTRICITY_PRICE_PER_KWH) {
    return failedRun(currentState, timestamp, 'invalid_electricity_rate');
  }

  const calculated = calculateSourceCoins(html, electricityRate, source, timestamp, currentState.previousValues);
  if (!calculated.ok) return failedRun(currentState, timestamp, calculated.reason, calculated.rejected);
  if (parserCollapse(currentState.previousValues, calculated.coins)) {
    return failedRun(currentState, timestamp, 'parser_collapse', calculated.rejected);
  }
  if (!calculated.coins.length) return failedRun(currentState, timestamp, 'no_valid_rows', calculated.rejected);

  const rankedResult = rankCoins(calculated.coins);
  const currentHash = snapshotHash(calculated.coins);
  const unchanged = currentState.snapshotHash === currentHash && currentState.lastRate === electricityRate;
  const lastChangedAt = unchanged ? currentState.lastChangedAt || timestamp : timestamp;
  const age = lastChangedAt ? new Date(timestamp).getTime() - new Date(lastChangedAt).getTime() : 0;
  const stale = unchanged && age > STALE_AFTER_MS;
  const events = stale ? [] : detectEvents(currentState, rankedResult);
  const pendingEvents = mergeEvents(currentState.pendingEvents, events);
  let pendingDiscordAlert = currentState.pendingDiscordAlert;
  if (pendingEvents.length) {
    const payload = buildDiscordPayload(rankedResult, pendingEvents, electricityRate, source, timestamp);
    pendingDiscordAlert = {
      id: hashString(`${currentHash}|${pendingEvents.map((item) => item.id).join('|')}`),
      createdAt: pendingDiscordAlert?.createdAt || timestamp,
      events: pendingEvents,
      payload,
      snapshotHash: currentHash,
    };
  }

  const seenCoins = { ...currentState.seenCoins };
  for (const coin of rankedResult.ranked) {
    const previous = seenCoins[coin.key];
    seenCoins[coin.key] = {
      firstSeenAt: previous?.firstSeenAt || timestamp,
      lastSeenAt: timestamp,
      competitive: coin.competitive,
    };
  }
  const nextState = {
    ...currentState,
    lastFetchedAt: timestamp,
    lastSuccessfulFetchedAt: timestamp,
    lastChangedAt,
    lastRate: electricityRate,
    snapshotHash: currentHash,
    previousValues: Object.fromEntries(rankedResult.ranked.map((coin) => [coin.key, coin])),
    previousRank: rankedResult.ranked.map((coin) => coin.key),
    seenCoins,
    pendingDiscordAlert,
    pendingEvents: pendingDiscordAlert ? pendingDiscordAlert.events : [],
    lastError: null,
  };
  return {
    ok: true,
    sourceStatus: stale ? 'stale' : 'ok',
    stale,
    coins: calculated.coins,
    ranked: rankedResult.ranked,
    rawLeader: rankedResult.rawLeader,
    maxRawNetProfit: rankedResult.maxRawNetProfit,
    baselinePowerW: rankedResult.baselinePowerW,
    events,
    pendingDiscordAlert,
    shouldPostDiscord: Boolean(pendingDiscordAlert && discordWebhookUrl && !stale),
    nextState,
    rejected: calculated.rejected,
  };
}

function completeDiscord(state, { success, sentAt = new Date().toISOString(), error = '' } = {}) {
  const currentState = normalizeState(state);
  const pending = currentState.pendingDiscordAlert;
  if (!pending) return currentState;
  const timestamp = validTimestamp(sentAt) || new Date().toISOString();
  if (success) {
    return {
      ...currentState,
      lastAlert: {
        id: pending.id,
        sentAt: timestamp,
        eventIds: pending.events.map((item) => item.id),
      },
      pendingDiscordAlert: null,
      pendingEvents: [],
      lastDiscordError: null,
    };
  }
  return {
    ...currentState,
    lastDiscordError: { at: timestamp, error: String(error || 'discord_request_failed') },
  };
}

const api = {
  SOURCE_URL,
  EXPECTED_GPU,
  ICT_TIMEZONE,
  ALERT_THRESHOLD_USD,
  COMPETITIVE_GAP_USD,
  STALE_AFTER_MS,
  MAX_ELECTRICITY_PRICE_PER_KWH,
  parseSource,
  calculateSourceCoins,
  calculateCoin,
  deduplicateCoins,
  rankCoins,
  stableKey,
  isThresholdMet,
  thresholdClassification,
  hasSignificantIncrease,
  meaningfulRankChange,
  createInitialState,
  processRun,
  completeDiscord,
  formatIct,
  buildDiscordPayload,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
