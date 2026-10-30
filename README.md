# DiffHarbor

DiffHarbor rehearses risky changes to legacy Python backends. It connects GitHub pull requests to a temporary GitHub Actions run, maps changed modules to importing modules and API routes, runs repository-approved checks against the base and candidate commits, and stores a structured evidence report.

The first analyzer target is a Python backend. React/TypeScript and other frameworks can be added as separate analyzers after this path works end to end.

## Stack

- React, TypeScript, and Vite for the dashboard.
- FastAPI for the API.
- PostgreSQL for installations, users, pull request runs, checks, and findings.
- Redis and ARQ for webhook-triggered background jobs.
- SQLAlchemy and Alembic for data access and schema migrations.
- GitHub App webhooks for installation and pull request events.
- GitHub Actions hosted runners for isolated base/candidate rehearsals.
- Python AST analysis for the first impact graph.

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

The TOML file is read from the pull request's base commit. It declares the Python version and the checks to run. Commands execute on a temporary GitHub-hosted runner without production credentials. The report artifact is retained for three days in GitHub Actions; DiffHarbor stores structured checks, Python impact data, and findings in PostgreSQL.

Some integration identifiers intentionally retain the original `changeguard` prefix for compatibility with the existing GitHub installation and repository setup. This includes environment variables, the `changeguard.toml` config file, and workflow/artifact identifiers. The API accepts both the old and new workflow display names.

## Current boundaries

- The dashboard and API require GitHub sign-in for pull request data.
- The first analyzer follows Python imports and recognizes common decorator-based routes. It reports its method and parse errors; the graph is not a complete proof of runtime behavior.
- The target repository must define `changeguard.toml` and safe test commands on its base branch.
- The GitHub App, webhook URL, runner workflow, and services need real credentials and a reachable deployment before live PR runs can be exercised.

## Hackathon demo

See the [90-second demo walkthrough](docs/hackathon-demo.md) for the working failure-and-fix example, links to its pull request and workflow runs, and a short recording checklist.

The dashboard's `/demo` view contains clearly marked fictional results and does not connect to GitHub or load saved workspace data. The Render static-site definition below publishes this judge demo without depending on your computer or any private service.

## Publish the public judge demo

The public `/demo` page is a static, read-only showcase. It uses fictional rehearsal data and does not require the API, PostgreSQL, Redis, GitHub sign-in, or secrets. A Render Static Site can host it independently from the private GitHub-connected service. The repository includes `render.yaml` for the demo service; connect this repository in Render and create the Blueprint. The deployed site will publish a permanent HTTPS link and redeploy from the configured branch. Live repository rehearsals still require the separately configured backend and worker.
