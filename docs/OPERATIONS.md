# Operations Guide

Run these commands from the repository root.

## Service commands

Start n8n:

```bash
docker compose up -d
```

Stop n8n without deleting its data:

```bash
docker compose stop
```

Restart n8n:

```bash
docker compose restart
```

Follow the service logs:

```bash
docker compose logs -f n8n-coin-detector
```

Check its status:

```bash
docker compose ps n8n-coin-detector
```

## Update n8n

The n8n version is pinned in `compose.yml`. Change the image tag there intentionally, then run:

```bash
docker compose pull n8n-coin-detector
docker compose up -d n8n-coin-detector
```

Confirm the service is healthy after the update:

```bash
docker compose ps n8n-coin-detector
docker compose logs --tail=50 n8n-coin-detector
```

## Backup persistent data

This backs up the complete n8n data volume, including workflows, credentials, execution data, and detector state.

```bash
mkdir -p backups
docker compose stop
docker run --rm \
  -v n8n-coin-detector-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar -czf "/backup/n8n-coin-detector-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
docker compose start
```

Store the backup securely. Credentials in it are encrypted using `N8N_ENCRYPTION_KEY`.

## Restore persistent data

Warning: restoring replaces all current n8n data. Use the same `N8N_ENCRYPTION_KEY` that was used when the backup was created.

Replace `BACKUP_FILE` with the backup filename:

```bash
BACKUP_FILE="$PWD/backups/n8n-coin-detector-YYYYMMDD-HHMMSS.tar.gz"
docker compose stop
docker run --rm \
  -v n8n-coin-detector-data:/data \
  -v "$BACKUP_FILE:/backup.tar.gz:ro" \
  alpine sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* && tar -xzf /backup.tar.gz -C /data'
docker compose start
```

Then open [http://localhost:6789](http://localhost:6789) and confirm that the workflow and credentials are present.

## Local validation

Regenerate the exported workflow:

```bash
node scripts/build-workflow.js
```

Run the automated tests:

```bash
node --test tests/*.test.js
```

Validate the Docker Compose file:

```bash
docker compose -f compose.yml config --quiet
```

Validate the exported workflow JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('workflows/coin-profitability-detector.json', 'utf8')); console.log('Workflow JSON is valid')"
```
