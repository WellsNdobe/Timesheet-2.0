# TempoLedger Timesheet

## Local development

Docker Desktop must be running. From the repository root, run:

```sh
npm run dev
```

This command starts the local Postgres 16 container, waits for it to become healthy, applies all Drizzle migrations to the container database, and starts the web and API development servers. Local API startup explicitly uses `postgresql://postgres:postgres@localhost:5432/timesheet` and disables email delivery, regardless of production configuration.

- Web: `http://localhost:5173`
- API: `http://localhost:3001`
- Stop the application with `Ctrl+C`.
- Stop the database container with `npm run db:local:down`.

The named `postgres_data` volume preserves local data between runs.

To use a separately managed database instead, run `npm run dev:external`; that retains the existing `.env`-driven behavior.

## Production deployment

Production deployment remains `npm run deploy:cloudflare`. The Worker continues to use its configured Hyperdrive binding and Cloudflare Email Service settings from `wrangler.jsonc`; none of the local database commands are part of that deployment path.
