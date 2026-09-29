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

## CodeRabbit reviews

CodeRabbit is configured in [`.coderabbit.yaml`](.coderabbit.yaml) for automatic reviews of non-draft pull requests targeting the default branch, including incremental reviews when commits are pushed. Reviews use the balanced `chill` profile, include a summary, and do not automatically approve pull requests.

To activate the integration:

1. Sign in to [CodeRabbit](https://app.coderabbit.ai) with GitHub and add `WellsNdobe/Timesheet-2.0`, granting the CodeRabbit GitHub App access to this repository.
2. Commit and push `.coderabbit.yaml` and this README to GitHub.
3. Open a non-draft pull request targeting the default branch and confirm CodeRabbit posts its review. For an existing pull request, comment `@coderabbitai review` to request a review.

The configuration file alone does not install the GitHub App. See the [CodeRabbit setup guide](https://docs.coderabbit.ai/getting-started/quickstart) and [configuration reference](https://docs.coderabbit.ai/reference/configuration).
