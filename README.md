# n8n Coin Profitability Detector

A Dockerized [n8n](https://n8n.io/) workflow that checks configured mining hardware once per day and sends one organized Discord digest containing every successful device.

## Features

- Supports multiple Hashrate.no GPU/CPU pages and XMRig CPU benchmark pages.
- Hardware is configured in [`config/hardware.json`](config/hardware.json) with a readable name and page URL.
- Makes one source GET request per configured device per daily run, with one limited retry after a failure.
- Separates revenue, electricity cost, and net profit.
- Prefers lower-power opportunities when net profit is reasonably close.
- Reports XMRig total and single-thread RandomX hashrate without inventing profitability data.
- Sends one organized Discord message every day with separate GPU and CPU sections. There is no `$1.25/day` alert gate.
- Continues processing other devices when one page fails.
- Persists per-device snapshots and Discord delivery status in Docker storage.
- Keeps Discord credentials in `.env`, which is ignored by Git.

## Quick start

```bash
cp .env.example .env
node scripts/validate-hardware-config.js
docker compose up -d
```

Set `ELECTRICITY_PRICE_PER_KWH`, `DISCORD_WEBHOOK_URL`, and a stable random `N8N_ENCRYPTION_KEY` in `.env` before starting. Then open [http://localhost:6789](http://localhost:6789), complete n8n's owner setup, import [`workflows/coin-profitability-detector.json`](workflows/coin-profitability-detector.json), and activate it.

The schedule is `00:00` in `Asia/Ho_Chi_Minh` (`GMT+7`). Full setup instructions are in [`docs/SETUP.md`](docs/SETUP.md).

## Add or change hardware

Edit [`config/hardware.json`](config/hardware.json):

```json
{
  "hardware": [
    {
      "name": "NVIDIA RTX 5060 Ti 16GB",
      "url": "https://www.hashrate.no/gpus/5060ti/"
    },
    {
      "name": "AMD Ryzen 9 7900X",
      "url": "https://www.hashrate.no/cpus/7900x/"
    },
    {
      "name": "AMD Ryzen 9 7950X",
      "url": "https://xmrig.com/benchmark?cpu=AMD+Ryzen+9+7950X"
    }
  ]
}
```

The platform is inferred from the URL hostname; do not add a `platform` or `type` field. Hashrate.no names must match the page title. XMRig names must match the `cpu` query value; the validator treats `®` as `(R)` and `™` as `(TM)` because XMRig commonly uses the ASCII forms. Use HTTPS URLs in one of these forms:

- `https://www.hashrate.no/gpus/<slug>/`
- `https://www.hashrate.no/cpus/<slug>/`
- `https://xmrig.com/benchmark?cpu=<encoded CPU name>`

XMRig results use the official `rx/0` benchmark API and show total plus single-thread hashrate. They do not show electricity, revenue, or profit because XMRig does not provide those values.

Validate the file:

```bash
node scripts/validate-hardware-config.js
```

The configuration is read from the mounted file at every workflow run. A JSON-only change does not require workflow re-import; after validation, run the workflow manually once and leave it active for the next midnight run. For workflow-code changes, regenerate and update the stored workflow as described in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Workflow

```text
Daily 00:00 ICT
      ↓
Load config/hardware.json
      ↓
Fetch one source per device
      ↓
Validate and normalize each response
      ↓
Calculate profitability for Hashrate.no or parse XMRig hashrate
      ↓
Rank each device independently
      ↓
Group successful devices into one Discord digest
      ↓
Save per-device state
```

If one device fails, its error is stored and its last good snapshot is preserved. Other configured devices can still appear in the grouped Discord digest.

## Electricity and ranking

The source's rolling `Rev. 24h` value is treated as revenue. Hashrate.no's displayed profit is not used because this project recalculates electricity cost using the configured rate:

```text
energy_kWh/day = power_W × 24 ÷ 1000
electricity_cost/day = energy_kWh/day × ELECTRICITY_PRICE_PER_KWH
net_profit/day = revenue_24h − electricity_cost/day
profit_per_watt = net_profit/day ÷ power_W
profit_per_kWh = net_profit/day ÷ energy_kWh/day
```

Coins within `$0.10/day` of the highest net profit are treated as competitive. Extra power receives a transparent score penalty, so a slightly lower-profit, much more efficient coin can rank first. A large profit advantage still wins over efficiency alone.

## Common commands

Run these from the repository root:

```bash
docker compose up -d                         # start
docker compose stop                          # stop
docker compose restart                       # restart
docker compose logs -f n8n-coin-detector     # logs
docker compose pull n8n-coin-detector && docker compose up -d n8n-coin-detector  # update
```

Backup and restore commands are in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Data source and limits

No API key is required. Hashrate.no uses its structured HTML estimate pages directly and recalculates electricity cost from the configured rate. XMRig uses its official [benchmark API](https://xmrig.com/docs/api/1/benchmark), which powers the benchmark page. Mining estimates and benchmark submissions can change over time; the digest is informational.

## Repository structure

```text
.
├── compose.yml
├── config/hardware.json
├── docs/SETUP.md
├── docs/OPERATIONS.md
├── scripts/build-workflow.js
├── scripts/validate-hardware-config.js
├── src/coin-detector-core.js
├── tests/coin-detector-core.test.js
└── workflows/coin-profitability-detector.json
```

## Security

- Never commit `.env` or paste its contents into chat.
- Keep `N8N_ENCRYPTION_KEY` stable across restarts and restores.
- Backups contain encrypted n8n credentials and must be stored privately.
