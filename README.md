# n8n Coin Profitability Detector

A Dockerized [n8n](https://n8n.io/) workflow that checks daily mining estimates for the **NVIDIA GeForce RTX 5060 Ti 16GB**, ranks opportunities by net profit and electricity efficiency, and sends meaningful changes to Discord.

## Features

- Uses the exact RTX 5060 Ti 16GB estimate page from [Hashrate.no](https://www.hashrate.no/gpus/5060ti/).
- Makes one logical source request per daily evaluation, with limited retries only after failures.
- Separates revenue, electricity cost, and net profit.
- Prefers lower-power options when their profit is reasonably close to the highest-profit option.
- Prioritizes opportunities at or above `$1.25/day` without allowing low-profit efficiency outliers to dominate.
- Rejects malformed, incomplete, stale, duplicate, and suspiciously extreme data.
- Avoids repeated Discord alerts when rankings have not changed meaningfully.
- Stores workflow history and detector state in a persistent Docker volume.

## Workflow

```text
Daily 00:00 ICT
      ↓
Fetch RTX 5060 Ti estimates
      ↓
Validate and normalize
      ↓
Calculate net profit and efficiency
      ↓
Reject suspicious data
      ↓
Rank opportunities
      ↓
Compare with previous state
      ↓
Discord alert when worthwhile
      ↓
Save state
```

The schedule uses `Asia/Ho_Chi_Minh` and runs at `00:00` each day. n8n is available only from the local machine at <http://localhost:6789>.

## Quick start

```sh
cp .env.example .env
docker compose up -d
```

Before starting, replace `N8N_ENCRYPTION_KEY` in `.env` with a stable random value. Add `DISCORD_WEBHOOK_URL` to enable Discord notifications, then keep `.env` private.

Open <http://localhost:6789>, complete the initial n8n account setup, import [`workflows/coin-profitability-detector.json`](workflows/coin-profitability-detector.json), and activate the workflow.

For complete instructions, see:

- [Setup and Discord configuration](docs/SETUP.md)
- [Operations, testing, backup, and restore](docs/OPERATIONS.md)

## Configuration

| Variable | Purpose | Example |
| --- | --- | --- |
| `N8N_ENCRYPTION_KEY` | Protects encrypted n8n data and must remain stable across restores. | A long random value |
| `ELECTRICITY_PRICE_PER_KWH` | Electricity price in USD per kWh used for net-profit calculations. | `0.10` |
| `DISCORD_WEBHOOK_URL` | Discord webhook used for alerts. Leave blank to disable delivery safely. | Set only in `.env` |

## Profitability and ranking

For electricity rate `r` in USD/kWh:

```text
energy_kWh/day = power_W × 24 ÷ 1000
electricity_cost/day = energy_kWh/day × r
net_profit/day = revenue_24h − electricity_cost/day
profit_per_watt = net_profit/day ÷ power_W
```

The detector first identifies the highest raw net profit. Opportunities within `$0.10/day` of it form a competitive group, where additional power consumption receives a transparent score penalty. This normally ranks `$1.35/day @ 120W` above `$1.40/day @ 200W`, while a major profit advantage such as `$2.00/day @ 200W` still beats `$1.20/day @ 100W`.

The source's rolling `Rev. 24h` value is treated as revenue. Hashrate.no's displayed profit is ignored because electricity cost is recalculated using this project's configured rate.

## Reliability and state

The workflow validates exact GPU identity, numeric fields, power limits, revenue limits, response size, stale snapshots, sudden spikes, and parser-collapse conditions before ranking data. A source or parsing failure preserves the previous successful state.

State is written atomically to `/home/node/.n8n/coin-detector-state.json` in the `n8n-coin-detector-data` Docker volume. Failed Discord deliveries remain pending and are not marked as sent.

## Repository structure

```text
.
├── compose.yml
├── .env.example
├── docs/
├── scripts/build-workflow.js
├── src/coin-detector-core.js
├── tests/coin-detector-core.test.js
└── workflows/coin-profitability-detector.json
```

## Data-source limitations

- Hashrate.no does not provide a reliable timestamp for every estimate, so the workflow records its own fetch time and treats unchanged snapshots as stale after 48 hours.
- Mining estimates can change quickly with coin prices, network difficulty, pool conditions, and miner software.
- Profitability estimates are informational and do not guarantee actual earnings.

## Security

- Keep the same `N8N_ENCRYPTION_KEY` when restoring n8n data.
