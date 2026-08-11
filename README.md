# Coin Profitability Detector

This packages an n8n workflow that checks the NVIDIA RTX 5060 Ti 16GB estimate page once per day and optionally sends a Discord digest. Docker/runtime configuration is verified. Live Discord delivery remains unverified because no live Discord webhook is available; a blank webhook safely skips the HTTP request.

## Source and limits

- Source: <https://www.hashrate.no/gpus/5060ti/>. The workflow makes one logical source GET per scheduled run and uses no API key.
- The parser requires the exact page title/model `NVIDIA RTX 5060 Ti 16GB`, reads direct `#myUL > li` estimate rows, and rejects merged entries such as `PRL+MDL`.
- The source does not provide a reliable source timestamp. Each accepted row stores `fetchedAt`, and an unchanged snapshot is treated as stale after 48 hours.
- Power and revenue fields must be complete decimal numeric strings; exponent and junk values are rejected. Derived values must be finite. `ELECTRICITY_PRICE_PER_KWH` must be between $0 and the documented plausible maximum of $10/kWh. Rows above 400W or $20 rolling 24h revenue, plus sudden revenue spikes, are rejected without generating a profitability alert; other valid rows remain usable.
- After a successful set has at least four entries, a new accepted set below 50% of that count is rejected as a parser collapse and the previous profitability state is preserved. Exactly 50% is accepted.
- The source's rolling `Rev. 24h` value is used. Displayed `Profit 24h` is not used.

## Calculations and ranking

For electricity rate `r` in USD/kWh:

```text
energy_kWh/day = power_W * 24 / 1000
electricity_cost/day = energy_kWh/day * r
net_profit = revenue_24h - electricity_cost/day
profit_per_watt = net_profit / power_W
profit_per_kWh = net_profit / energy_kWh/day
```

Ranking first finds the maximum raw net profit. Coins within `$0.10` of that maximum form the competitive set. The minimum power in that set is the baseline; each coin receives a penalty of `min($0.10, max(0, power_W - baseline_W) * $0.001/W)`. Sort order is score descending, raw net descending, power ascending, then stable ticker/algorithm key. This favors `$1.35 @ 120W` over `$1.40 @ 200W`, while `$2.00 @ 200W` beats `$1.20 @ 100W`. The exact threshold is `net_profit >= $1.25`.

## Setup and import

1. Create the local environment file:

   ```sh
   cp .env.example .env
   ```

2. Replace `N8N_ENCRYPTION_KEY` with a stable random value. Keep `.env` private. Set `DISCORD_WEBHOOK_URL` only if Discord alerts are wanted; the workflow never hardcodes a webhook.

3. Validate the Compose file, then start n8n:

   ```sh
   docker compose config
   docker compose up -d
   ```

4. Open <http://localhost:6789>, finish n8n's initial account setup, and use the UI's **Import from File** action for `workflows/coin-profitability-detector.json`. UI import is the preferred and canonical path. The JSON intentionally has no top-level `id`; n8n assigns one on import. Activate the workflow after import. The schedule is 00:00 in `Asia/Ho_Chi_Minh`.

The Code nodes use only `fs` and `path`, enabled by `NODE_FUNCTION_ALLOW_BUILTIN=fs,path`. State is atomically stored at `/home/node/.n8n/coin-detector-state.json` inside the named volume `n8n-coin-detector-data`. It tracks previous values/rank, seen coins, the last successfully sent alert, and pending Discord events. A Discord failure leaves the pending alert in place and does not mark it as sent.

Compose binds n8n to `127.0.0.1:6789` only and sets `N8N_CONCURRENCY_PRODUCTION_LIMIT=1` so scheduled production runs are serialized. `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` permits workflow nodes to read environment variables, which is required for the direct `$env.DISCORD_WEBHOOK_URL` reference; protect n8n UI/execution access and keep `.env` private.

## Operations

```sh
# start
docker compose up -d

# stop
docker compose stop

# restart
docker compose restart

# follow logs
docker compose logs -f n8n-coin-detector

# update the pinned n8n image: first change the explicit image tag in compose.yml
# to a reviewed version, then pull and recreate only this service.
docker compose pull n8n-coin-detector && docker compose up -d n8n-coin-detector
```

Back up the persistent n8n volume safely. Stop n8n first and write the archive outside this repository:

```sh
docker compose stop
BACKUP_DIR="${HOME}/backups/coin-detector"
mkdir -p "$BACKUP_DIR"
docker run --rm \
  -v n8n-coin-detector-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf /backup/n8n-coin-detector-$(date +%Y%m%d-%H%M%S).tgz -C /data .
docker compose up -d
```

Restore only after confirming the archive. **This empties the target volume before extraction. Keep the exact same `N8N_ENCRYPTION_KEY` in `.env`; changing it makes the restored encrypted n8n data unreadable.**

```sh
docker compose stop
BACKUP_DIR="${HOME}/backups/coin-detector"
docker run --rm \
  -v n8n-coin-detector-data:/data \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xzf /backup/FILE.tgz -C /data'
docker compose up -d
```

## Local checks

```sh
node scripts/build-workflow.js
node --test tests/*.test.js
docker compose -f compose.yml config --quiet
node -e "JSON.parse(require('node:fs').readFileSync('workflows/coin-profitability-detector.json', 'utf8'))"
```
