# Setup Guide

## Prerequisites

- Docker Engine with the Docker Compose plugin
- A web browser
- A Discord webhook URL if you want notifications

Hashrate.no does not require an API key for this workflow. It reads the RTX 5060 Ti 16GB page at `https://www.hashrate.no/gpus/5060ti/`.

## 1. Configure environment variables

Create your private environment file:

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

- `ELECTRICITY_PRICE_PER_KWH` is your electricity price in USD per kWh.
- `DISCORD_WEBHOOK_URL` is created in Discord under **Channel Settings > Integrations > Webhooks**.
- Keep the same `N8N_ENCRYPTION_KEY` when restoring a backup.

Never commit `.env` or paste its contents into chat. The file is ignored by Git.

## 2. Validate and start n8n

Validate the Compose configuration:

```bash
docker compose -f compose.yml config --quiet
```

Start the service:

```bash
docker compose up -d
```

Confirm that it is running:

```bash
docker compose ps n8n-coin-detector
```

Open [http://localhost:6789](http://localhost:6789) and complete n8n's initial owner-account setup if prompted.

## 3. Import the workflow

1. In n8n, open **Workflows**.
2. Choose **Import from File**.
3. Select `workflows/coin-profitability-detector.json` from this repository.
4. Save the imported workflow.
5. Confirm the schedule trigger says **Daily 00:00 ICT**.
6. Activate the workflow.

The workflow runs every day at `00:00` in the `Asia/Ho_Chi_Minh` timezone.

## 4. Validate notifications

1. Open the imported workflow.
2. Select **Execute Workflow** to run it manually.
3. Confirm that the execution finishes without errors.
4. Confirm that a concise mining-opportunity message appears in the configured Discord channel when the alert rules are met.

If no alert is sent, inspect the execution output first. Unchanged results are intentionally suppressed to prevent duplicate daily notifications.

## Setup troubleshooting

- **Port 6789 is already in use:** stop the process using it, then run `docker compose up -d` again.
- **Discord returns an error:** verify that `DISCORD_WEBHOOK_URL` is complete and that the webhook still exists.
- **The workflow is inactive after import:** open it and use the **Active** toggle.
- **The schedule shows the wrong time:** confirm `GENERIC_TIMEZONE=Asia/Ho_Chi_Minh` in the resolved Compose configuration.
