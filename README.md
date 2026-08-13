# n8n Coin Profitability Detector

A Dockerized [n8n](https://n8n.io/) workflow that checks [Hashrate.no](https://hashrate.no/) once per day, ranks mining opportunities for configured hardware, and sends one concise Discord digest per successful device.

## Features

- Supports multiple Hashrate.no GPU and CPU pages.
- Hardware is configured in [`config/hardware.json`](config/hardware.json) with a readable name and page URL.
- Makes one Hashrate.no GET request per configured device per daily run, with one limited retry after a failure.
- Separates revenue, electricity cost, and net profit.
- Prefers lower-power opportunities when net profit is reasonably close.
- Sends a digest every day for each successfully parsed device. There is no `$1.25/day` alert gate.
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
    }
  ]
}
```

The name must match the hardware name shown by the Hashrate.no page. Only HTTPS URLs on `hashrate.no` using `/gpus/<slug>/` or `/cpus/<slug>/` are accepted.

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
Fetch one page per device
      ↓
Validate and normalize each response
      ↓
Calculate net profit and efficiency
      ↓
Rank each device independently
      ↓
Post one Discord digest per successful device
      ↓
Save per-device state
```

If one device fails, its error is stored and its last good snapshot is preserved. Other configured devices can still produce Discord digests.

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

No Hashrate.no API key is required. The workflow uses the structured HTML estimate pages directly and validates the configured hardware title before parsing rows. Mining estimates change with coin prices, network difficulty, pool conditions, and miner software; the digest is informational.

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
