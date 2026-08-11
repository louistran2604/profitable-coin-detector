'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'src', 'coin-detector-core.js'), 'utf8');
const workflowPath = path.join(root, 'workflows', 'coin-profitability-detector.json');

function embeddedCore() {
  return `const core = (() => {\n${coreSource}\nreturn api;\n})();`;
}

const stateCode = `
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

const input = $input.first()?.json ?? null;
const html = inputBody(input);
const rate = Number($env.ELECTRICITY_PRICE_PER_KWH);
const result = core.processRun({
  html,
  state: readState(),
  electricityRate: rate,
  source: core.SOURCE_URL,
  fetchedAt: new Date().toISOString(),
  discordWebhookUrl: String($env.DISCORD_WEBHOOK_URL || '').trim(),
});

try {
  writeState(result.nextState);
} catch (error) {
  return [{ json: { ...result, shouldPostDiscord: false, discordConfigured: Boolean($env.DISCORD_WEBHOOK_URL), persistenceError: String(error.message || error) } }];
}

return [{ json: { ...result, discordConfigured: Boolean($env.DISCORD_WEBHOOK_URL), statePath: STATE_PATH } }];
`;

const finalizeCode = `
const fs = require('fs');
const path = require('path');
${embeddedCore()}

const STATE_PATH = '/home/node/.n8n/coin-detector-state.json';
function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const temporaryPath = STATE_PATH + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryPath, STATE_PATH);
}

const staged = $('Stage alert').first()?.json || {};
const response = $input.first()?.json || {};
const statusCode = Number(response.statusCode ?? response.status ?? 204);
const succeeded = !response.error && statusCode >= 200 && statusCode < 300;
const nextState = core.completeDiscord(staged.nextState, {
  success: succeeded,
  sentAt: new Date().toISOString(),
  error: response.error || response.message || 'HTTP ' + statusCode,
});
writeState(nextState);
return [{ json: { ...staged, discordSucceeded: succeeded, discordStatusCode: statusCode, statePath: STATE_PATH } }];
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
      parameters: {
        method: 'GET',
        url: 'https://www.hashrate.no/gpus/5060ti/',
        options: {
          timeout: 15000,
          response: { response: { responseFormat: 'text' } },
        },
        responseFormat: 'text',
      },
      id: 'baf7ac21-7db7-4b36-a6ae-2c9f1d7e4b80',
      name: 'Fetch source HTML',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [240, 0],
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 1000,
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: stateCode },
      id: 'c1e6e9a5-a3dd-4c4d-a113-5b7e2f9a0c64',
      name: 'Stage alert',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [500, 0],
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
      name: 'Should post Discord alert?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [760, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ $env.DISCORD_WEBHOOK_URL }}',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.pendingDiscordAlert.payload) }}',
        options: {
          timeout: 10000,
          response: { response: { responseFormat: 'text' } },
        },
      },
      id: 'a9e35f58-3da8-4a2e-86f7-4c1b9e7d3056',
      name: 'Post Discord alert',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1020, -80],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: finalizeCode },
      id: 'd3bd0d90-47f7-4f14-a16f-6e2a8c9b1d74',
      name: 'Finalize Discord state',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1280, -80],
    },
  ],
  connections: {
    'Daily 00:00 ICT': { main: [[{ node: 'Fetch source HTML', type: 'main', index: 0 }]] },
    'Fetch source HTML': { main: [[{ node: 'Stage alert', type: 'main', index: 0 }]] },
    'Stage alert': { main: [[{ node: 'Should post Discord alert?', type: 'main', index: 0 }]] },
    'Should post Discord alert?': { main: [[{ node: 'Post Discord alert', type: 'main', index: 0 }], []] },
    'Post Discord alert': { main: [[{ node: 'Finalize Discord state', type: 'main', index: 0 }]] },
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
