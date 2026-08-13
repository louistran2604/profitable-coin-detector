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

## Change hardware configuration

For a hardware-only change, edit `config/hardware.json`, validate it, and run the workflow manually:

```bash
node scripts/validate-hardware-config.js
docker compose ps n8n-coin-detector
```

The workflow reads the mounted file at the start of every run, so it does not need to be re-imported or restarted for a JSON-only change.

The platform is inferred from each URL. Hashrate.no entries use `/gpus/<slug>/` or `/cpus/<slug>/`; XMRig entries use `https://xmrig.com/benchmark?cpu=<encoded CPU name>`. The XMRig `cpu` query must match the configured `name`; `®`/`™` are accepted as equivalents of XMRig's `(R)`/`(TM)` notation.

## Update workflow code in the existing n8n workflow

Use this procedure after changing `src/coin-detector-core.js` or `scripts/build-workflow.js`. It replaces the existing workflow instead of creating a duplicate.

1. Regenerate and validate the export:

   ```bash
   node scripts/build-workflow.js
   node -e "JSON.parse(require('fs').readFileSync('workflows/coin-profitability-detector.json', 'utf8')); console.log('Workflow JSON is valid')"
   ```

2. Copy the workflow ID from the existing n8n workflow URL. Set it in your shell:

   ```bash
   WORKFLOW_ID='paste-the-existing-workflow-id-here'
   ```

3. Create a temporary update file with that ID and active status:

   ```bash
   WORKFLOW_ID="$WORKFLOW_ID" node -e "const fs=require('fs'); const w=JSON.parse(fs.readFileSync('workflows/coin-profitability-detector.json','utf8')); w.id=process.env.WORKFLOW_ID; w.active=true; fs.writeFileSync('/tmp/coin-profitability-detector-update.json', JSON.stringify(w, null, 2));"
   ```

4. Import it into the running container, activate it, and restart n8n:

   ```bash
   docker cp /tmp/coin-profitability-detector-update.json n8n-coin-detector:/tmp/coin-profitability-detector-update.json
   docker exec n8n-coin-detector n8n import:workflow --input=/tmp/coin-profitability-detector-update.json
   docker exec n8n-coin-detector n8n update:workflow --id="$WORKFLOW_ID" --active=true
   docker compose restart n8n-coin-detector
   ```

5. Open [http://localhost:6789](http://localhost:6789), confirm the workflow is active, and run it manually once.

Do not use the first-time **Import from File** flow for updates unless you intentionally want a second workflow. The generated export has no fixed n8n ID until the update command adds the existing one.

## Update n8n

The n8n version is pinned in `compose.yml`. Change the image tag intentionally, then run:

```bash
docker compose pull n8n-coin-detector
docker compose up -d n8n-coin-detector
```

Confirm the service is healthy:

```bash
docker compose ps n8n-coin-detector
docker compose logs --tail=50 n8n-coin-detector
```

## Backup persistent data

The Docker volume contains n8n workflows, credentials, execution data, and detector state. The hardware configuration is a separate host file, so copy it separately too.

```bash
mkdir -p backups
cp config/hardware.json backups/hardware-$(date +%Y%m%d-%H%M%S).json
docker compose stop
docker run --rm \
  -v n8n-coin-detector-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine tar -czf "/backup/n8n-coin-detector-$(date +%Y%m%d-%H%M%S).tar.gz" -C /data .
docker compose start
```

Store backups securely. Credentials in the n8n archive are encrypted using `N8N_ENCRYPTION_KEY`.

## Restore persistent data

Restoring replaces current n8n data. Use the same `N8N_ENCRYPTION_KEY` that was used when the backup was created.

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

Restore the matching `hardware-*.json` file to `config/hardware.json`, then open [http://localhost:6789](http://localhost:6789) and confirm that the workflow and credentials are present.

## Local validation

Regenerate the exported workflow:

```bash
node scripts/build-workflow.js
```

Validate hardware configuration, tests, Compose, and workflow JSON:

```bash
node scripts/validate-hardware-config.js
node --test tests/*.test.js
docker compose -f compose.yml config --quiet
node -e "JSON.parse(require('fs').readFileSync('workflows/coin-profitability-detector.json', 'utf8')); console.log('Workflow JSON is valid')"
```

Persistent detector state is stored at `/home/node/.n8n/coin-detector-state.json` inside the `n8n-coin-detector-data` volume. It contains a `devices` map keyed by the normalized hardware source. Each device stores its last good snapshot and Discord result; XMRig devices also store `lastBenchmark` with the selected total and single-thread hashrates.
