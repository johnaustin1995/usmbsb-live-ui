# USM Live UI

Single-container deployment for the Southern Miss live game dashboard and API.

## Local run

1. Copy `.env.example` to `.env`.
2. Build and run:

```bash
docker compose up -d --build
```

3. Open:

- `http://localhost:8787/usm-live.html`

## Hostinger deployment

Deploy this repo as a Docker Compose project.

After deploy, verify:

```bash
docker ps --filter name=usmbsb-web
docker logs --tail 100 -f usmbsb-web
curl http://127.0.0.1:8787/health
```

## Notes

- Schedule file defaults to `data/schedules/southern-miss-2026.json`.
- Override with `USM_SCHEDULE_FILE` in `.env` if needed.
