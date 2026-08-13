'use strict';

const DEFAULT_HARDWARE = Object.freeze({
  name: 'NVIDIA RTX 5060 Ti 16GB',
  url: 'https://www.hashrate.no/gpus/5060ti/',
  type: 'gpu',
  slug: '5060ti',
  key: 'gpu:5060ti',
});
const ICT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const MAX_POWER_W = 400;
const MAX_REVENUE_24H_USD = 20;
const MAX_ELECTRICITY_PRICE_PER_KWH = 10;

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

function parseHashrate(value) {
  const text = normalizeWhitespace(value);
  const match = text.match(/^(\d[\d.,]*)\s*([kMGTPE]?)(h|sol)\/s$/i);
  if (!match) return null;
  const amount = parseNumber(match[1]);
  if (amount === null) return null;
  const prefix = match[2] ? (match[2].toLowerCase() === 'k' ? 'k' : match[2].toUpperCase()) : '';
  const base = match[3].toLowerCase() === 'sol' ? 'Sol' : 'H';
  return { value: amount, unit: `${prefix}${base}/s` };
}

function calculateHashrateEfficiency(hashrate, powerW) {
  const parsed = parseHashrate(hashrate);
  if (!parsed || !Number.isFinite(powerW) || powerW <= 0) return null;
  return {
    value: parsed.value / powerW,
    unit: `${parsed.unit}/W`,
  };
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

function parseHardwareUrl(value) {
  const raw = String(value ?? '').trim();
  const protocol = raw.match(/^([a-z][a-z\d+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (protocol !== 'https') return { ok: false, reason: 'url_must_use_https' };
  const host = raw.match(/^https:\/\/([^/?#]+)/i)?.[1]?.toLowerCase();
  if (!['hashrate.no', 'www.hashrate.no'].includes(host)) {
    return { ok: false, reason: 'url_host_must_be_hashrate_no' };
  }
  if (/[?#]/.test(raw)) return { ok: false, reason: 'url_must_not_have_query_or_fragment' };
  const match = raw.match(/^https:\/\/(?:hashrate\.no|www\.hashrate\.no)\/(gpus|cpus)\/([^/]+)\/?$/i);
  if (!match) return { ok: false, reason: 'url_path_must_be_gpu_or_cpu_page' };
  const type = match[1].toLowerCase() === 'gpus' ? 'gpu' : 'cpu';
  const slug = match[2].toLowerCase();
  return {
    ok: true,
    type,
    slug,
    url: `https://${host}/${match[1].toLowerCase()}/${slug}/`,
  };
}

function normalizeHardwareEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const name = normalizeWhitespace(entry.name);
  const parsedUrl = parseHardwareUrl(entry.url);
  if (!name || !parsedUrl.ok) return null;
  return {
    name,
    url: parsedUrl.url,
    type: parsedUrl.type,
    slug: parsedUrl.slug,
    key: `${parsedUrl.type}:${parsedUrl.slug}`,
  };
}

function validateHardwareConfig(value) {
  const entries = Array.isArray(value) ? value : value?.hardware;
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, hardware: [], errors: ['hardware must be a non-empty array'] };
  }

  const hardware = [];
  const errors = [];
  const names = new Set();
  const urls = new Set();
  for (const [index, entry] of entries.entries()) {
    const normalized = normalizeHardwareEntry(entry);
    if (!normalized) {
      const name = normalizeWhitespace(entry?.name) || `entry ${index + 1}`;
      const urlReason = parseHardwareUrl(entry?.url).reason;
      errors.push(`${name}: ${urlReason === 'invalid_url' ? 'invalid url' : 'name and url are required'}`);
      continue;
    }
    const nameKey = normalized.name.toLowerCase();
    if (names.has(nameKey)) errors.push(`${normalized.name}: duplicate name`);
    if (urls.has(normalized.url)) errors.push(`${normalized.name}: duplicate url`);
    names.add(nameKey);
    urls.add(normalized.url);
    hardware.push(normalized);
  }
  return { ok: errors.length === 0, hardware: errors.length ? [] : hardware, errors };
}

function parseHardwareConfigText(text) {
  let value;
  try {
    value = JSON.parse(String(text));
  } catch (error) {
    return { ok: false, hardware: [], errors: [`invalid JSON: ${error.message}`] };
  }
  return validateHardwareConfig(value);
}

function exactHardwareMarker(html, hardware) {
  const titleTag = extractFirstTag(html, 'title');
  const titleMatch = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';
  const metaTags = String(html).match(/<meta\b[^>]*>/gi) || [];
  const metaTitleTag = metaTags.find((tag) => /\bname\s*=\s*(["'])title\1/i.test(tag));
  const metaTitle = metaTitleTag ? extractAttribute(metaTitleTag, 'content') : '';
  const expectedName = normalizeWhitespace(hardware?.name);
  const expectedTitle = title === expectedName || title.startsWith(`${expectedName} |`);
  const expectedMeta = !metaTitle || metaTitle === expectedName;

  return {
    ok: Boolean(titleTag && expectedName && expectedTitle && expectedMeta),
    title,
    metaTitle,
    reason: !titleTag ? 'missing_title' : !expectedName ? 'missing_hardware_name' : !expectedTitle ? 'wrong_hardware_title' : !expectedMeta ? 'wrong_hardware_meta_title' : '',
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

function parseSource(html, hardware = DEFAULT_HARDWARE) {
  if (typeof html !== 'string' || !html.trim()) {
    return { ok: false, reason: 'empty_source', rows: [], rejected: [] };
  }
  const normalizedHardware = normalizeHardwareEntry(hardware);
  if (!normalizedHardware) return { ok: false, reason: 'invalid_hardware', rows: [], rejected: [] };
  const marker = exactHardwareMarker(html, normalizedHardware);
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
  const hashrateEfficiency = calculateHashrateEfficiency(raw.hashrate, raw.powerW);
  if ([energyKwhPerDay, electricityCostPerDay, netProfit, profitPerWatt, profitPerKwh].some((value) => !Number.isFinite(value))) {
    return null;
  }
  return {
    coin: raw.coin,
    ticker: raw.ticker,
    algorithm: raw.algorithm,
    hashrate: raw.hashrate,
    hashratePerWatt: hashrateEfficiency?.value ?? null,
    hashrate_per_watt: hashrateEfficiency?.value ?? null,
    hashratePerWattUnit: hashrateEfficiency?.unit ?? null,
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
    source,
    fetchedAt,
    key: stableKey(raw.ticker, raw.algorithm),
  };
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

function calculateSourceCoins(html, electricityRate, source, fetchedAt, previousValues = {}, hardware = DEFAULT_HARDWARE) {
  const parsed = parseSource(html, hardware);
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
  const competitive = coins.filter((coin) => coin.netProfit >= maxRawNetProfit - 0.10);
  const baselinePowerW = Math.min(...competitive.map((coin) => coin.powerW));
  const ranked = coins.map((coin) => {
    const penalty = Math.min(0.10, Math.max(0, coin.powerW - baselinePowerW) * 0.001);
    return {
      ...coin,
      competitive: coin.netProfit >= maxRawNetProfit - 0.10,
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

function parserCollapse(previousValues, currentCoins) {
  const previousCount = Object.keys(previousValues || {}).length;
  return previousCount >= 4 && currentCoins.length * 2 < previousCount;
}

function hardwareSummary(hardware) {
  const normalized = normalizeHardwareEntry(hardware);
  return normalized ? { ...normalized } : null;
}

function createDeviceState(hardware = null) {
  return {
    hardware: hardwareSummary(hardware),
    lastFetchedAt: null,
    lastSuccessfulFetchedAt: null,
    previousValues: {},
    previousRank: [],
    lastDiscord: null,
    lastError: null,
  };
}

function normalizeDeviceState(value, hardware = null) {
  const initial = createDeviceState(hardware);
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...initial,
    ...source,
    hardware: hardwareSummary(hardware) || source.hardware || null,
    previousValues: source.previousValues && typeof source.previousValues === 'object' ? source.previousValues : {},
    previousRank: Array.isArray(source.previousRank) ? source.previousRank : [],
  };
}

function createInitialState() {
  return { version: 2, devices: {} };
}

function normalizeState(state, hardwareList = []) {
  const value = state && typeof state === 'object' ? state : {};
  const configured = hardwareList.filter(Boolean).map((hardware) => normalizeHardwareEntry(hardware)).filter(Boolean);
  const configuredByKey = new Map(configured.map((hardware) => [hardware.key, hardware]));
  const devices = {};

  if (value.version === 2 && value.devices && typeof value.devices === 'object') {
    for (const [key, device] of Object.entries(value.devices)) {
      const hardware = configuredByKey.get(key) || device?.hardware || null;
      devices[key] = normalizeDeviceState(device, hardware);
    }
    return { version: 2, devices };
  }

  const legacyHardware = configured.find((hardware) => hardware.key === DEFAULT_HARDWARE.key) || configured[0];
  if (legacyHardware && (value.previousValues || value.previousRank || value.lastFetchedAt || value.lastSuccessfulFetchedAt)) {
    devices[legacyHardware.key] = normalizeDeviceState({
      hardware: legacyHardware,
      lastFetchedAt: value.lastFetchedAt || null,
      lastSuccessfulFetchedAt: value.lastSuccessfulFetchedAt || null,
      previousValues: value.previousValues || {},
      previousRank: value.previousRank || [],
      lastError: value.lastError || null,
    }, legacyHardware);
  }
  return { version: 2, devices };
}

function replaceDevice(state, hardwareKey, device) {
  return {
    version: 2,
    devices: {
      ...(state.devices || {}),
      [hardwareKey]: device,
    },
  };
}

function validTimestamp(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function failedDeviceRun(state, hardware, timestamp, reason, rejected = []) {
  const hardwareKey = hardware?.key || 'unknown';
  const previous = state.devices?.[hardwareKey] || createDeviceState(hardware);
  const device = {
    ...previous,
    hardware: hardwareSummary(hardware) || previous.hardware,
    lastFetchedAt: timestamp,
    lastError: { at: timestamp, reason, rejected },
  };
  return {
    ok: false,
    sourceStatus: reason,
    hardware: hardwareSummary(hardware),
    hardwareKey,
    ranked: [],
    rawLeader: null,
    digestPayload: null,
    nextState: replaceDevice(state, hardwareKey, device),
    error: reason,
    rejected,
  };
}

function processDeviceRun({ hardware, html, state, electricityRate, fetchedAt = new Date().toISOString() }) {
  const normalizedHardware = normalizeHardwareEntry(hardware);
  const timestamp = validTimestamp(fetchedAt) || new Date().toISOString();
  const currentState = normalizeState(state, normalizedHardware ? [normalizedHardware] : []);
  if (!normalizedHardware) return failedDeviceRun(currentState, hardware, timestamp, 'invalid_hardware');
  if (!Number.isFinite(electricityRate) || electricityRate < 0 || electricityRate > MAX_ELECTRICITY_PRICE_PER_KWH) {
    return failedDeviceRun(currentState, normalizedHardware, timestamp, 'invalid_electricity_rate');
  }

  const currentDevice = currentState.devices[normalizedHardware.key] || createDeviceState(normalizedHardware);
  const calculated = calculateSourceCoins(
    html,
    electricityRate,
    normalizedHardware.url,
    timestamp,
    currentDevice.previousValues,
    normalizedHardware,
  );
  if (!calculated.ok) return failedDeviceRun(currentState, normalizedHardware, timestamp, calculated.reason, calculated.rejected);
  if (parserCollapse(currentDevice.previousValues, calculated.coins)) {
    return failedDeviceRun(currentState, normalizedHardware, timestamp, 'parser_collapse', calculated.rejected);
  }
  if (!calculated.coins.length) return failedDeviceRun(currentState, normalizedHardware, timestamp, 'no_valid_rows', calculated.rejected);

  const rankedResult = rankCoins(calculated.coins);
  const device = {
    ...currentDevice,
    hardware: normalizedHardware,
    lastFetchedAt: timestamp,
    lastSuccessfulFetchedAt: timestamp,
    previousValues: Object.fromEntries(rankedResult.ranked.map((coin) => [coin.key, coin])),
    previousRank: rankedResult.ranked.map((coin) => coin.key),
    lastError: null,
  };
  const nextState = replaceDevice(currentState, normalizedHardware.key, device);
  return {
    ok: true,
    sourceStatus: 'ok',
    hardware: normalizedHardware,
    hardwareKey: normalizedHardware.key,
    coins: calculated.coins,
    ranked: rankedResult.ranked,
    rawLeader: rankedResult.rawLeader,
    maxRawNetProfit: rankedResult.maxRawNetProfit,
    baselinePowerW: rankedResult.baselinePowerW,
    digestPayload: buildDiscordPayload(rankedResult, normalizedHardware, electricityRate, timestamp),
    nextState,
    rejected: calculated.rejected,
  };
}

function completeDiscord(state, hardwareKey, { success, sentAt = new Date().toISOString(), statusCode = null, error = '' } = {}) {
  const currentState = normalizeState(state);
  const device = currentState.devices[hardwareKey];
  if (!device) return currentState;
  const timestamp = validTimestamp(sentAt) || new Date().toISOString();
  return replaceDevice(currentState, hardwareKey, {
    ...device,
    lastDiscord: {
      at: timestamp,
      success: Boolean(success),
      statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
      error: success ? null : String(error || 'discord_request_failed'),
    },
  });
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

function coinBlock(coin, electricityRate) {
  const hashrateEfficiency = Number.isFinite(coin.hashratePerWatt) && coin.hashratePerWattUnit
    ? `${coin.hashratePerWatt.toFixed(3)} ${coin.hashratePerWattUnit}`
    : 'Unavailable';
  const energy24h = Number.isFinite(coin.energyKwhPerDay)
    ? `${coin.energyKwhPerDay.toFixed(2)} kWh`
    : 'Unavailable';
  const revenuePerKwh = Number.isFinite(coin.energyKwhPerDay) && coin.energyKwhPerDay > 0
    ? `${formatUsd(coin.revenue24h / coin.energyKwhPerDay)}/kWh`
    : 'Unavailable';
  return [
    `${coin.rank}. **${coin.coin}** (${coin.ticker}) • ${coin.algorithm}`,
    '',
    'HASHRATE',
    `Hashrate (mining speed): ${coin.hashrate}`,
    `Efficiency (hashrate per watt): ${hashrateEfficiency}`,
    '',
    'POWER',
    `Power (estimated draw): ${coin.powerW} W`,
    `Energy use (24h): ${energy24h}`,
    `Electricity cost (24h): ${formatUsd(coin.electricityCostPerDay)}`,
    '',
    'INCOME',
    `Revenue (24h, before electricity): ${formatUsd(coin.revenue24h)}`,
    `Revenue efficiency (24h revenue per kWh): ${revenuePerKwh}`,
    `Net profit (24h, after electricity): ${formatUsd(coin.netProfit)}`,
    `Efficiency (net profit per kWh): ${formatUsd(coin.profitPerKwh)}/kWh`,
  ].join('\n');
}

function buildDiscordPayload(rankedResult, hardware, electricityRate, fetchedAt) {
  const top = rankedResult.ranked.slice(0, 3);
  const rawLeader = rankedResult.rawLeader;
  const typeLabel = String(hardware.type || 'hardware').toUpperCase();
  const blocks = top.map((coin) => coinBlock(coin, electricityRate));
  if (rawLeader && (!top[0] || rawLeader.key !== top[0].key)) {
    blocks.push(`Highest raw net profit: ${rawLeader.coin} (${rawLeader.ticker}/${rawLeader.algorithm}) — ${formatUsd(rawLeader.netProfit)} after electricity, using ${rawLeader.powerW} W`);
  }
  return {
    embeds: [{
      description: [
        `Fetched: ${formatIct(fetchedAt)} profitable coins digest`,
        `Hardware: ${typeLabel} • **${hardware.name}**`,
        `Electricity rate: ${formatUsd(electricityRate)}/kWh`,
        '',
        blocks.join('\n\n'),
      ].join('\n'),
      url: hardware.url,
      color: 0x5865f2,
      footer: { text: 'Source: Hashrate.no' },
    }],
    allowed_mentions: { parse: [] },
  };
}

const api = {
  DEFAULT_HARDWARE,
  ICT_TIMEZONE,
  MAX_POWER_W,
  MAX_REVENUE_24H_USD,
  MAX_ELECTRICITY_PRICE_PER_KWH,
  normalizeWhitespace,
  parseHashrate,
  calculateHashrateEfficiency,
  parseHardwareUrl,
  normalizeHardwareEntry,
  validateHardwareConfig,
  parseHardwareConfigText,
  exactHardwareMarker,
  parseSource,
  calculateSourceCoins,
  calculateCoin,
  deduplicateCoins,
  rankCoins,
  stableKey,
  parserCollapse,
  createDeviceState,
  createInitialState,
  normalizeState,
  processDeviceRun,
  completeDiscord,
  formatIct,
  buildDiscordPayload,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
