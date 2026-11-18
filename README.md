# Inception Tree Map

Öffentliche Karte aller Bäume, Schulen und Communities von Inception e.V. in Uganda: **https://trees.inception.green**

## Aufbau

| Teil | Wo |
|---|---|
| Webseite (Next.js + TypeScript, Google Maps) | `src/` |
| Datenbank-Tabellen (Supabase) | `supabase/migrations/` |
| Nächtlicher Abgleich Notion + Greenstand → Supabase | `scripts/sync.ts` |
| Server (Hetzner, Docker, Caddy mit HTTPS) | `Dockerfile`, `docker-compose.yml`, `deploy/` |
| Alte Webflow-Skripte (2022) | `legacy-webflow/` |

Datenquellen:
- **Schulen und Communities:** Notion (Schools / Communities – Tracking). Das Team trägt weiter nur dort ein.
- **Bäume:** öffentliche Greenstand-Kartenschnittstelle (`webmap/trees`, Filter `map_name`).

## Lokal starten

```bash
cp .env.example .env   # ausfüllen
npm install
npm run dev            # ohne Supabase-Daten zeigt die Karte Beispieldaten
npm run sync -- --dry-run
```

## Sicherheit

Dieses Repo ist **öffentlich**. Zugangsdaten gehören nur in die `.env` auf dem Server, nie in den Code.
