'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'coin-detector-core.js'), 'utf8');
const workflowPath = path.join(root, 'workflows', 'coin-profitability-detector.json');

function embeddedCore() {
  return `const core = (() => {\n${coreSource}\nreturn api;\n})();`;
}

const loadConfigCode = `
const fs = require('fs');
${embeddedCore()}

const CONFIG_PATH = '/home/node/config/hardware.json';
const validation = core.parseHardwareConfigText(fs.readFileSync(CONFIG_PATH, 'utf8'));
if (!validation.ok) throw new Error('Invalid hardware configuration: ' + validation.errors.join('; '));

return validation.hardware.map((hardware) => ({
  json: { hardware },
  pairedItem: { item: 0 },
}));
`;

const stageCode = `
const fs = require('fs');
const path = require('path');
${embeddedCore()}

const STATE_PATH = '/home/node/.n8n/coin-detector-state.json';

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return core.createInitialState();
    throw error;
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const temporaryPath = STATE_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, STATE_PATH);
}

function inputBody(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.body === 'string') return value.body;
  if (typeof value.data === 'string') return value.data;
  if (typeof value.html === 'string') return value.html;
  return null;
}

const configItems = $('Load hardware config').all();
const inputItems = $input.all();
const rate = Number($env.ELECTRICITY_PRICE_PER_KWH);
const discordConfigured = Boolean(String($env.DISCORD_WEBHOOK_URL || '').trim());
const fetchedAt = new Date().toISOString();
let state = readState();
const output = [];

for (let index = 0; index < inputItems.length; index += 1) {
  const inputItem = inputItems[index];
  const paired = inputItem.pairedItem;
  const configIndex = Number.isInteger(paired) ? paired : Number.isInteger(paired?.item) ? paired.item : index;
  const hardware = configItems[configIndex]?.json?.hardware;
  const response = inputItem.json || {};
  const fetchStatusCode = Number(response.statusCode ?? response.status ?? 0);
  let result;

  if (!hardware) {
    result = {
      ok: false,
      sourceStatus: 'missing_hardware_link',
      hardware: null,
      hardwareKey: null,
      ranked: [],
      rawLeader: null,
      digestPayload: null,
      nextState: state,
      error: 'missing_hardware_link',
      rejected: [],
    };
  } else {
    result = core.processDeviceRun({
      hardware,
      html: inputBody(response),
      state,
      electricityRate: rate,
      fetchedAt,
    });
    state = result.nextState;
  }

  output.push({
    json: {
      ...result,
      fetchStatusCode,
      discordConfigured,
      shouldPostDiscord: Boolean(result.ok && discordConfigured),
      statePath: STATE_PATH,
    },
    pairedItem: { item: index },
  });
}

writeState(state);
return output;
`;

const finalizeCode = `
const fs = require('fs');
const path = require('path');
${embeddedCore()}

const STATE_PATH = '/home/node/.n8n/coin-detector-state.json';

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return core.createInitialState();
    throw error;
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const temporaryPath = STATE_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, STATE_PATH);
}

const stagedItems = $('Stage digests').all();
const responseItems = $input.all();
let state = readState();
const output = [];

for (let index = 0; index < responseItems.length; index += 1) {
  const responseItem = responseItems[index];
  const paired = responseItem.pairedItem;
  const stageIndex = Number.isInteger(paired) ? paired : Number.isInteger(paired?.item) ? paired.item : index;
  const staged = stagedItems[stageIndex]?.json || {};
  const response = responseItem.json || {};
  const statusCode = Number(response.statusCode ?? response.status ?? 204);
  const succeeded = !response.error && statusCode >= 200 && statusCode < 300;
  state = core.completeDiscord(state, staged.hardwareKey, {
    success: succeeded,
    sentAt: new Date().toISOString(),
    statusCode,
    error: response.error || response.message || 'HTTP ' + statusCode,
  });
  output.push({
    json: {
      ...staged,
      discordSucceeded: succeeded,
      discordStatusCode: statusCode,
      statePath: STATE_PATH,
    },
    pairedItem: { item: index },
  });
}

writeState(state);
return output;
`;

const workflow = {
  name: 'Coin Profitability Detector',
  nodes: [
    {
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 0 * * *' }],
        },
      },
      id: '8f08f4c2-8f3f-4bc4-a0b6-0e1c0f4e9a11',
      name: 'Daily 00:00 ICT',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 0],
    },
    {
      parameters: {},
      id: '7e19d2c4-6f8a-4b0d-9c31-5a72e4f8b016',
      name: 'Manual test',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [0, 180],
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: loadConfigCode },
      id: 'c6d7e8f9-a0b1-4c2d-9e3f-5a6b7c8d9e01',
      name: 'Load hardware config',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [240, 0],
    },
    {
      parameters: {
        method: 'GET',
        url: '={{ $json.hardware.url }}',
        options: {
          timeout: 15000,
          response: { response: { responseFormat: 'text', fullResponse: true } },
        },
        responseFormat: 'text',
      },
      id: 'baf7ac21-7db7-4b36-a6ae-2c9f1d7e4b80',
      name: 'Fetch hardware data',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [500, 0],
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: stageCode },
      id: 'c1e6e9a5-a3dd-4c4d-a113-5b7e2f9a0c64',
      name: 'Stage digests',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [760, 0],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: '6a7e6dcf-3e4c-4b4b-ae7c-8d2e6f1a4c91',
              leftValue: '={{ $json.shouldPostDiscord }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true' },
            },
            {
              id: 'd4b7f2e8-90a1-4cc5-b2de-7f6a3c8e5b20',
              leftValue: '={{ $json.discordConfigured }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'true' },
            },
          ],
          combinator: 'and',
        },
      },
      id: 'be5c5e14-eaf8-49bb-8a8b-7d3c1e6f902a',
      name: 'Should post Discord digest?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1020, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ $env.DISCORD_WEBHOOK_URL }}',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.digestPayload) }}',
        options: {
          timeout: 10000,
          response: { response: { responseFormat: 'text', fullResponse: true } },
        },
        responseFormat: 'text',
      },
      id: 'a9e35f58-3da8-4a2e-86f7-4c1b9e7d3056',
      name: 'Post Discord digests',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1280, -80],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: finalizeCode },
      id: 'd3bd0d90-47f7-4f14-a16f-6e2a8c9b1d74',
      name: 'Finalize Discord state',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1540, -80],
    },
  ],
  connections: {
    'Daily 00:00 ICT': { main: [[{ node: 'Load hardware config', type: 'main', index: 0 }]] },
    'Manual test': { main: [[{ node: 'Load hardware config', type: 'main', index: 0 }]] },
    'Load hardware config': { main: [[{ node: 'Fetch hardware data', type: 'main', index: 0 }]] },
    'Fetch hardware data': { main: [[{ node: 'Stage digests', type: 'main', index: 0 }]] },
    'Stage digests': { main: [[{ node: 'Should post Discord digest?', type: 'main', index: 0 }]] },
    'Should post Discord digest?': { main: [[{ node: 'Post Discord digests', type: 'main', index: 0 }], []] },
    'Post Discord digests': { main: [[{ node: 'Finalize Discord state', type: 'main', index: 0 }]] },
  },
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'Asia/Ho_Chi_Minh',
  },
  versionId: 'b9bb2b7a-4d7b-4e6a-a853-1c6f9e2a7048',
  meta: { templateCredsSetupCompleted: true },
  pinData: {},
  tags: [],
};

fs.writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
