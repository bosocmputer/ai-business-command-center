# Server Deployment

Target test server:

- Host: `192.168.2.109`
- App path: `/home/bosscatdog/deployments/ai-business-command-center`
- Web port: `3055`
- API port: `4055`
- Compose project: `ai-business-command-center`

## Safety Rules

- Do not use ports already occupied by other projects, especially `3000`, `4000`, `8080`, `5432`, or existing Billflow/TCC/OpenClaw ports.
- Do not run `docker system prune -a` on the shared server.
- Do not delete Docker volumes unless their owner/project is confirmed.
- Keep `.env.server` on the server only. Never commit real SML or LINE credentials.

## First Deploy

```bash
mkdir -p /home/bosscatdog/deployments
cd /home/bosscatdog/deployments
git clone <repo-url> ai-business-command-center
cd ai-business-command-center
cp infra/env.server.example .env.server
chmod 600 .env.server
```

Edit `.env.server`, then:

```bash
docker compose -f infra/docker-compose.yml --env-file .env.server up -d --build
```

Smoke test:

```bash
curl http://127.0.0.1:4055/health
curl http://127.0.0.1:4055/api/tenants
```

Open:

```text
http://192.168.2.109:3055/command-center
```

## Update Deploy

```bash
cd /home/bosscatdog/deployments/ai-business-command-center
git pull --ff-only
docker compose -f infra/docker-compose.yml --env-file .env.server up -d --build
docker compose -f infra/docker-compose.yml ps
```

## Logs

```bash
docker compose -f infra/docker-compose.yml logs -f api
docker compose -f infra/docker-compose.yml logs -f web
```

## Stop Only This Project

```bash
docker compose -f infra/docker-compose.yml down
```

Do not add `-v` unless you intentionally want to remove the local JSON report snapshot volume.

## Safe Cleanup Candidates On Shared Server

Low risk:

```bash
docker builder prune
```

This removes Docker build cache only. It should not stop running containers, but future builds may be slower.

Needs owner confirmation first:

- dangling images with no running containers
- stopped containers
- volumes with `LINKS = 0`

Avoid without a backup:

- `docker system prune -a --volumes`
- deleting `postgres` volumes
- deleting project directories under `/home/bosscatdog`
