# Setup Guide

## Prerequisites

- Docker Engine with the Docker Compose plugin
- Node.js for local validation and workflow generation
- A web browser
- A Discord webhook URL if you want notifications

Hashrate.no does not require an API key. The workflow reads one structured estimate page for each hardware entry in `config/hardware.json`.

## 1. Configure environment variables

Create the private environment file:

```bash
cp .env.example .env
```

Generate an n8n encryption key:

```bash
openssl rand -hex 32
```

Open `.env` and set:

```dotenv
ELECTRICITY_PRICE_PER_KWH=0.10
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
N8N_ENCRYPTION_KEY=paste-your-generated-key-here
```

- `ELECTRICITY_PRICE_PER_KWH` is the electricity price in USD per kWh.
- `DISCORD_WEBHOOK_URL` is created in Discord under **Channel Settings > Integrations > Webhooks**.
- Keep the same `N8N_ENCRYPTION_KEY` when restoring a backup.

Never commit `.env` or paste its contents into chat. The file is ignored by Git.

## 2. Configure hardware

Edit `config/hardware.json`. Add one object per device:

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

The platform is inferred from the URL; do not add a `platform` or `type` field.

- Hashrate.no names must match the hardware page title. Use `https://www.hashrate.no/gpus/<slug>/` or `https://www.hashrate.no/cpus/<slug>/`.
- XMRig names must match the `cpu` query value. The validator treats `®` as `(R)` and `™` as `(TM)`. Use `https://xmrig.com/benchmark?cpu=<encoded CPU name>`.

XMRig uses the official `rx/0` benchmark API and reports total and single-thread hashrate. It does not produce electricity, revenue, or profit values.

Validate the file before starting n8n:

```bash
node scripts/validate-hardware-config.js
```

The workflow creates one independent result per configured device, then combines successful devices into one Discord message with separate GPU and CPU sections. If one device fails, the other devices continue.

## 3. Validate and start n8n

Validate the Compose configuration:

```bash
docker compose -f compose.yml config --quiet
```

Start the service:

```bash
docker compose up -d
```

Confirm it is running:

```bash
docker compose ps n8n-coin-detector
```

Open [http://localhost:6789](http://localhost:6789) and complete n8n's initial owner-account setup if prompted.

## 4. Import the workflow for the first time

1. In n8n, open **Workflows**.
2. Choose **Import from File**.
3. Select `workflows/coin-profitability-detector.json`.
4. Save the imported workflow.
5. Confirm the trigger is **Daily 00:00 ICT**.
6. Activate the workflow.

The schedule runs every day at `00:00` in the `Asia/Ho_Chi_Minh` timezone.

## 5. Test the workflow

1. Open the imported workflow.
2. Select **Execute Workflow**.
3. Confirm each configured device reaches its digest stage without errors.
4. Confirm one organized Discord message appears with a separate entry for each successful device.

If a device has no valid rows, its failure is recorded in persistent state and no fake Discord digest is sent for that device.

## After changing `config/hardware.json`

The running workflow reads the mounted JSON file at the start of every execution. For a configuration-only change:

```bash
node scripts/validate-hardware-config.js
docker compose ps n8n-coin-detector
```

No workflow re-import or container restart is required. Run **Execute Workflow** manually once to verify the new device, then leave the workflow active for the next `00:00 ICT` run.

If you changed `src/coin-detector-core.js` or `scripts/build-workflow.js`, follow the workflow-code update procedure in [`OPERATIONS.md`](OPERATIONS.md) instead.

## Setup troubleshooting

- **Port 6789 is already in use:** stop the process using it, then run `docker compose up -d` again.
- **Invalid hardware configuration:** run `node scripts/validate-hardware-config.js` and fix the reported entry.
- **Wrong hardware title:** copy the exact hardware name from the Hashrate.no page into `name`.
- **Discord returns an error:** verify that `DISCORD_WEBHOOK_URL` is complete and that the webhook still exists.
- **The schedule shows the wrong time:** confirm `GENERIC_TIMEZONE=Asia/Ho_Chi_Minh` in the resolved Compose configuration.
