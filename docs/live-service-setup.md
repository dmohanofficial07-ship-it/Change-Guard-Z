# Deploy the live DiffHarbor app

The existing `render.yaml` publishes the public, read-only sample. Use the separate `render-live.yaml` only when you are ready to create the live API, worker, Postgres database, and queue. Those plans are paid; review current Render pricing before creating the Blueprint.

## What the live deployment does

- Serves the React dashboard and FastAPI endpoints from one HTTPS address, so GitHub sign-in can use a same-origin session cookie.
- Stores GitHub users, pull request run records, check results, and findings in Postgres.
- Receives GitHub App webhooks and queues work in the Redis-compatible Key Value service.
- Runs background dispatch and report collection in a separate worker.
- Runs repository checks in GitHub Actions, not in the DiffHarbor web service.

## Setup

1. In Render, create a **new Blueprint** for this repository and select `render-live.yaml`. Keep the existing `diffharbor-demo` service and `render.yaml` unchanged.
2. Review the paid plans in the Blueprint before creating resources. The database plan is persistent; do not replace it with Render's free Postgres plan for ongoing use because free databases expire after 30 days.
3. Enter the GitHub App ID, slug, private key, webhook secret, OAuth client ID, and OAuth client secret in Render's secret fields. Paste the PEM as a multiline value in Render. Never commit these values or send them in chat.
4. After Render creates `diffharbor-live`, copy its HTTPS URL. In the GitHub App settings, set:
   - Homepage URL: the live app URL
   - User authorization callback URL: `<live-app-url>/api/auth/github/callback`
   - Webhook URL: `<live-app-url>/api/github/webhook`
   - Webhook events: `installation`, `pull_request`, `pull_request_review`, and `workflow_run`
5. If people outside the app owner's GitHub account must install it, make the GitHub App publicly installable. Keep installation selection limited to repositories the user chooses.
6. Sign in through the live app, install the App on a disposable Python repository, and add the workflow and config from `integrations/github/templates/` to that repository's default branch.
7. Open a test pull request in that repository. Confirm the worker dispatches GitHub Actions, the report reaches Postgres, and only an authorized GitHub user can view that run in the dashboard.

The current runner executes the repository's configured checks on a temporary GitHub-hosted runner. Same-repository pull requests run automatically; fork pull requests wait for an approval by a repository collaborator with write or admin access. The first analyzer supports Python backends.
