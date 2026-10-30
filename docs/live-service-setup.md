# Deploy the live DiffHarbor app on Cloudflare Free

This deployment connects a real GitHub account and stores real pull request evidence. It uses Cloudflare Workers, D1, and Queues on their Free plan. Check runs are restricted to **public GitHub repositories**, where standard GitHub-hosted Actions runners are free. Private repositories are deliberately excluded so the service does not create paid Actions usage.

The existing read-only `/demo` page remains available as a fictional walkthrough. The signed-in workspace at `/` shows real run data for public repositories where the GitHub App is installed.

## What runs where

- Cloudflare Workers serves the Vite dashboard and a small TypeScript API.
- Cloudflare D1 stores GitHub account metadata, run summaries, checks, and findings. OAuth tokens are encrypted before they are stored.
- A Cloudflare Queue schedules workflow dispatch away from the webhook request.
- GitHub Actions checks the base and pull request commits on a temporary standard Ubuntu runner. The Python analyzer and runner are checked out from the target repository's default branch, separately from the pull request candidate.
- Candidate tests run in a job without OIDC permission. A separate job publishes the report with a GitHub Actions identity token, and the Worker asks GitHub to confirm that token's run ID belongs to this rehearsal. The report is compressed between jobs and kept below GitHub's job-output size limit; no artifact storage is needed.

Cloudflare Free currently includes 100,000 Worker requests per day and 10 ms CPU per HTTP request; D1 includes 5 million rows read/day, 100,000 rows written/day, and 5 GB of storage; Queues includes 10,000 operations/day with up to 24 hours of message retention. These are hard limits: requests can fail after limits are reached, but the Free plan does not automatically convert those overages into a paid bill. GitHub documents standard hosted runners as free and unlimited for public repositories. Review the [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) before launch.

## Before you begin

- A Cloudflare account that remains on the Free plan.
- Node.js 24 and npm.
- The DiffHarbor GitHub App ID, slug, private key, webhook secret, OAuth client ID, and OAuth client secret. Keep the private key and client secret out of Git, screenshots, and chat.
- The GitHub App must be configured with **Contents: read**, **Pull requests: read**, and **Actions: write**. Subscribe to `installation`, `pull_request`, `pull_request_review`, and `workflow_run` events.

Do not enable paid Cloudflare features or a paid GitHub runner. If a Cloudflare Free limit is reached, the live API may pause or return an error until usage resets.

## Create the Cloudflare resources

From the repository root in PowerShell:

1. Build the dashboard files:

   ```powershell
   npm.cmd --prefix frontend ci
   npm.cmd --prefix frontend run build
   ```

2. Install the deployment CLI and sign in:

   ```powershell
   npm.cmd --prefix cloudflare install
   cd cloudflare
   npx.cmd wrangler login
   ```

3. Create the D1 database and let Wrangler write its ID to the existing binding in `wrangler.jsonc`:

   ```powershell
   npx.cmd wrangler d1 create diffharbor --update-config --config wrangler.jsonc
   ```

4. Create the run queue and dead-letter queue:

   ```powershell
   npx.cmd wrangler queues create diffharbor-runs
   npx.cmd wrangler queues create diffharbor-runs-dlq
   ```

5. Apply the schema and deploy:

   ```powershell
   npm.cmd run migrate:remote
   npm.cmd run typecheck
   npm.cmd run deploy
   ```

Wrangler prints the new `workers.dev` HTTPS URL after deployment. In the Cloudflare dashboard, open the `diffharbor-live` Worker and add the variable `APP_PUBLIC_URL` with that exact origin, such as `https://diffharbor-live.account-name.workers.dev`. Then deploy again so workflow dispatches know where to send their reports.

## Add secrets

In Cloudflare, open **Workers & Pages → diffharbor-live → Settings → Variables and Secrets**. Add these as encrypted secrets:

| Secret name | Value |
| --- | --- |
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_APP_SLUG` | App slug from its GitHub URL |
| `GITHUB_APP_PRIVATE_KEY` | Entire PEM private key |
| `GITHUB_WEBHOOK_SECRET` | The random webhook secret saved in the GitHub App |
| `GITHUB_CLIENT_ID` | GitHub App OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub App OAuth client secret |
| `SESSION_SECRET` | A new random value used to sign browser sessions |
| `AUTH_TOKEN_ENCRYPTION_KEY` | A new random 32-byte key encoded as base64 |

Generate the last two values locally with Node; do not reuse the webhook secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Set `APP_PUBLIC_URL` as the plain-text Worker variable described above. Keep `GITHUB_WORKFLOW_FILE=changeguard.yml` in `wrangler.jsonc` unless you deliberately name the target workflow differently.

## Point the GitHub App at the Worker

In the GitHub App's **General** settings, set:

- Homepage URL: the Worker URL.
- User authorization callback URL: `<worker-url>/api/auth/github/callback`.
- Webhook URL: `<worker-url>/api/github/webhook`.
- Webhook secret: the same value as the Cloudflare `GITHUB_WEBHOOK_SECRET` secret.

Keep the webhook events listed above. Make the App available for installation on other accounts only if other users need to try it. Each person should install it only on a repository they own or are permitted to connect.

## Connect a public Python repository

1. Sign in through the Cloudflare Worker and install the GitHub App on one public Python repository.
2. Add `changeguard.toml` and `.github/workflows/changeguard.yml` to the repository's default branch. Copy the current files from `integrations/github/templates/`.
3. Confirm the workflow has the `diffharbor_url` workflow-dispatch input, the `id-token: write` permission, and the **Publish signed report to DiffHarbor** step. Older copies of the workflow must be updated to include them.
4. Open a same-repository pull request. The app schedules it and the dashboard shows its real check and impact evidence. Pull requests from forks wait for an approval by a repository collaborator with write or admin permission.

Private repository pull requests are acknowledged by the webhook but never queued or run. The API also excludes private repositories from the signed-in user's visible workspace. To protect the free usage boundary, the Worker rejects report callbacks unless the signed GitHub Actions token identifies the expected public repository, workflow file, default branch, and run, then confirms the run with GitHub's API.

## Local development

The existing `backend/` FastAPI + PostgreSQL + Redis path is for local development and self-hosting. The Cloudflare deployment uses the separate Worker API and D1 schema described above. For the local path, see the main [README](../README.md). The static Render demo configuration in `render.yaml` is separate and does not deploy the live API.
