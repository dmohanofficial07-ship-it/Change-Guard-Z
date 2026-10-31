# DiffHarbor

DiffHarbor rehearses risky pull requests before a team merges them. It compares repository-configured checks on the base and candidate commits. Its impact map currently analyzes Python imports and common API routes. Other-language checks can be configured as shell commands when the workflow provides their runtime, but those languages do not yet get an impact map or turnkey setup.

## Judge quick start

> [!IMPORTANT]
> **Judges: start here**
>
> - [Open the live read-only demo](https://diffharbor-live.diffharbor-cloudflare.workers.dev/demo). No GitHub account is needed to explore it; the sample results are fictional.
> - To try the live workflow with a repository you control, open the [GitHub-connected workspace](https://diffharbor-live.diffharbor-cloudflare.workers.dev) and sign in with **your own GitHub account**. You do not need the project owner's account.
> - **Current install status (31 October 2026): Public.** Judges can [install ChangeGuard Northstar](https://github.com/apps/changeguard-northstar/installations/new) on a public GitHub repository they own or are allowed to connect. Review the requested permissions and select only the repository you want to connect. Organization installations may require an organization owner’s approval. GitHub does not let a public app return to private while it is installed on other accounts.
> - For a real rehearsal, add [`changeguard.toml`](integrations/github/templates/changeguard.toml) and [the workflow template](integrations/github/templates/changeguard-workflow.yml) to that repository's default branch, then open a pull request. The hosted free preview runs public repositories only.
>
> **Quick walkthrough:** [failure-and-fix demo PR](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2) · [setup guide](docs/live-service-setup.md) · [judge constraints and FAQ](docs/judge-guide.md)

The fully validated analyzer path is a Python backend. The runner accepts configured shell commands, so another stack's tests may work when its runtime is available or installed by the repository workflow. That is not the same as first-class support: Python is the only language with an impact map today.

## Stack

- React, TypeScript, and Vite for the dashboard.
- A TypeScript Cloudflare Worker for the free hosted API, with D1 for records and Queues for background dispatch.
- GitHub App OAuth and signed webhooks for account connection and pull request events.
- Standard GitHub-hosted Actions runners for public repository checks. Private repositories are excluded from the free hosted path.
- A Python helper runner for comparing base and candidate checks, plus Python AST impact analysis.
- FastAPI, PostgreSQL, Redis, and ARQ remain available as the local development/self-hosted path under `backend/`.

## Local development

Use Python 3.14, Node.js 24, and Docker Compose for the local PostgreSQL and Redis services. Docker Desktop is not included in this workspace and must be installed before the services can start.

1. Copy `backend/.env.example` to `backend/.env` and set the GitHub App and auth values.
2. Start PostgreSQL and Redis from the repository root with `docker compose up -d`.
3. In a backend terminal, create and activate the virtual environment, install dependencies, and apply migrations:

   ```powershell
   & "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -e .
   alembic upgrade head
   ```
4. Start the API from `backend` with `python -m app`.
5. In a second terminal, open `frontend`, run `npm.cmd ci`, then `npm.cmd run dev`. If the API is on another port, set `CHANGEGUARD_API_URL` (for example, `http://127.0.0.1:8001`) before starting Vite.

The API is available at `http://localhost:8000`; the Vite dashboard is available at `http://localhost:5173`. GitHub webhooks require an HTTPS URL GitHub can reach. For local GitHub integration, expose the Vite port (`5173`) through an HTTPS tunnel, then set both `CHANGEGUARD_PUBLIC_URL` and `FRONTEND_ORIGIN` to that public URL so the OAuth session cookie reaches the callback. Vite forwards `/api` requests to FastAPI. Set `COOKIE_SECURE=true` when using HTTPS; leave it false for plain local HTTP.

Generate local secrets with Python:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Use the first value for `SESSION_SECRET` and the second for `AUTH_TOKEN_ENCRYPTION_KEY`. Keep `backend/.env` private.

## GitHub App configuration

Set the GitHub App webhook URL to `${CHANGEGUARD_PUBLIC_URL}/api/github/webhook` and its user authorization callback URL to `${CHANGEGUARD_PUBLIC_URL}/api/auth/github/callback`. Configure these repository permissions:

- Contents: read
- Pull requests: read
- Actions: write

Subscribe to the `installation`, `pull_request`, `pull_request_review`, and `workflow_run` events. Same-repository pull requests run automatically. Fork pull requests are recorded as `approval required`; DiffHarbor starts one only after a collaborator with write or admin permission approves the current head commit. The App uses its installation token to dispatch a workflow; the runner receives only a read-only repository token and no production secrets.

## Add a target repository

Copy `integrations/github/analyzer.py` and `integrations/github/runner.py` into the target repository under `integrations/github/`. Copy `integrations/github/templates/changeguard-workflow.yml` to `.github/workflows/changeguard.yml` and `integrations/github/templates/changeguard.toml` to the repository root as `changeguard.toml`. Commit these files to the target's default branch, then install the GitHub App on the repository.

The TOML file is read from the pull request's base commit. It declares the Python version for DiffHarbor's helper and the shell commands to run. Those commands may invoke another language's test tool if the workflow provides that runtime. Commands execute on a temporary GitHub-hosted runner without production credentials. Candidate code runs in a job without OIDC permission; a separate job publishes the structured result with a GitHub Actions identity token. Cloudflare verifies the repository and workflow, confirms the run with GitHub, then saves the evidence in D1.

Some integration identifiers intentionally retain the original `changeguard` prefix for compatibility with the existing GitHub installation and repository setup. This includes environment variables, the `changeguard.toml` config file, and workflow inputs. The API accepts both the old and new workflow display names.

## Current boundaries

- The dashboard and API require GitHub sign-in for pull request data.
- The hosted Cloudflare deployment runs public repositories only. Private repository checks are not queued, keeping the GitHub Actions path in the no-cost public-runner category.
- The impact map follows Python imports and recognizes common decorator-based routes. Non-Python checks may be configured, but their files and routes are not mapped. The graph is not a complete proof of runtime behavior.
- The target repository must define `changeguard.toml` and safe test commands on its base branch.
- Cloudflare Free and GitHub public-runner limits apply. If a free quota is reached, checks or dashboard requests can fail until the quota resets.

## Hackathon demo

See the [2-minute demo walkthrough](docs/hackathon-demo.md) for the working failure-and-fix example, links to its pull request and workflow runs, and a short recording checklist.

The dashboard's `/demo` view contains clearly marked fictional results and does not connect to GitHub or load saved workspace data. The separate static-site definition in `render.yaml` can publish this judge demo without depending on your computer or any private service.

## Publish the public judge demo

The public `/demo` page is a static, read-only showcase. It uses fictional rehearsal data and does not require the API, storage, GitHub sign-in, or secrets. The existing `render.yaml` is only for that demo. The full public-repository app is deployed separately to Cloudflare Free and includes `/demo` as well as the GitHub-connected workspace.

## Deploy the live user-facing service

Follow [`docs/live-service-setup.md`](docs/live-service-setup.md) to deploy the GitHub-connected app on Cloudflare Free, configure secrets and the GitHub App URLs, and connect a public repository. Use Python for the complete analyzer path; other stacks need custom workflow runtime setup and receive check comparisons only.
