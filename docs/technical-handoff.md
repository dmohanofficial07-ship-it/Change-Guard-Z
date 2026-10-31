# DiffHarbor — technical handoff

**Prepared:** 31 October 2026
**Repository:** dmohanofficial07-ship-it/Change-Guard-Z
**Source snapshot inspected:** main at 93ef3ae
**Purpose:** A factual technical brief for another model, a reviewer, or a two-minute explainer video.

## Executive summary

DiffHarbor is a GitHub pull-request rehearsal service. Before a team merges a proposed change, it runs the repository's configured checks against two exact revisions: the pull request base commit and the candidate commit. It compares the results, stores evidence, and presents the comparison in a dashboard. Python repositories also get a static import-impact map and a limited map of API routes recognized from Python decorators.

The product began from the pain of manually checking whether changes could break a backend service. Its implemented scope is pre-merge change review. It does not inspect Linux production logs, monitor a live service, generate a patch, merge a pull request, or deploy production.

The deployed application uses a React/TypeScript dashboard and a TypeScript Cloudflare Worker API. Cloudflare D1 stores run metadata and evidence; Cloudflare Queues decouple webhook handling from workflow dispatch; GitHub Actions checks the two revisions. The repository also contains a separate FastAPI/PostgreSQL/Redis implementation for local development or self-hosting. That backend is not the API used by the current Cloudflare deployment.

## Live surfaces and repository links

- **GitHub source:** https://github.com/dmohanofficial07-ship-it/Change-Guard-Z
- **Live application:** https://diffharbor-live.diffharbor-cloudflare.workers.dev
- **Read-only judge demo:** https://diffharbor-live.diffharbor-cloudflare.workers.dev/demo
- **Help page and 50-second Tuli animation:** https://diffharbor-live.diffharbor-cloudflare.workers.dev/demo/help
- **GitHub App install page:** https://github.com/apps/changeguard-northstar/installations/new
- **Failure-and-fix example PR:** https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2
- **Dashboard screenshot:** docs/assets/dashboard-help.jpg

The read-only demo is populated with fictional example data and can be explored without GitHub login. The real workflow is separate: a user signs in with their own GitHub account, installs the public GitHub App on a public repository they control or are permitted to connect, adds the setup files to its default branch, and opens a pull request. The GitHub App is named ChangeGuard Northstar; DiffHarbor is the product name.

## Product workflow

1. **Connect GitHub.** The user signs in through GitHub OAuth and installs the GitHub App on selected repositories.
2. **Add repository configuration.** The target repository's default branch receives changeguard.toml and .github/workflows/changeguard.yml. The TOML file defines Python version, optional install/setup/cleanup commands, and one or more named shell checks.
3. **Open or update a pull request.** GitHub sends installation, pull_request, review, and workflow_run webhooks to the Worker. The Worker accepts supported non-draft pull-request events only for public repositories.
4. **Record exact source revisions.** The run row records repository ID, pull-request number, base SHA, head SHA, refs, installation ID, and state. A unique key prevents duplicate runs for the same repository, PR, and head SHA. GitHub delivery IDs are also persisted to make webhook processing idempotent.
5. **Queue dispatch.** The webhook handler puts a small dispatch message on the Cloudflare Queue. This keeps workflow dispatch out of the synchronous webhook request.
6. **Dispatch GitHub Actions.** The Worker signs a short-lived GitHub App JWT, exchanges it for a narrowly permissioned installation token, and dispatches the named workflow on the repository's default branch. It supplies the run ID, PR number, base/head SHAs, and report callback URL as workflow inputs.
7. **Rehearse base and candidate.** The workflow checks out trusted analyzer code from the default branch, then separately checks out the exact base commit and pull-request head. The trusted runner loads configuration from the base checkout, verifies both actual checkout SHAs, and uses the same configuration for each version.
8. **Build and publish evidence.** The runner writes structured JSON: check status and bounded output for each side, Python impact information, findings, and an overall status. A separate publisher job requests a GitHub Actions OIDC token with audience diffharbor and posts the report to the Worker.
9. **Verify and display.** The Worker validates the token signature and claims, confirms the corresponding workflow run through GitHub's API, checks report IDs and SHAs against the stored rehearsal, then saves the results. The dashboard reads the evidence and links to the GitHub Actions run.

## Result semantics

For each configured check, the dashboard compares the baseline and candidate status:

| Baseline | Candidate | Dashboard meaning |
| --- | --- | --- |
| passed | failed | New failure: the change introduced a failure in this check |
| failed | failed | Already failing: the check failed before and after |
| failed | passed | Fixed by change |
| passed | passed | Passing on both versions |
| timeout, skipped, or unknown | any non-comparable status | Inconclusive; evidence is insufficient to label it a regression or fix |

The comparison is deterministic. It does not infer root cause with an AI model. The human reviewer interprets the output and decides whether to merge.

## Architecture and implementation

### Hosted path

- **Frontend:** React 19, TypeScript, Vite 8, and lucide-react. The single-page app is built to frontend/dist and served by the Worker asset binding.
- **Edge/API:** Cloudflare Worker written in TypeScript. It routes /api/* requests to API handlers and passes other paths to static assets; SPA fallback serves frontend routes.
- **Persistence:** Cloudflare D1 (SQLite-compatible) with schema in cloudflare/migrations/0001_initial.sql.
- **Async dispatch:** Cloudflare Queues producer RUN_QUEUE, queue consumer batch size one, three retries, and dead-letter queue diffharbor-runs-dlq.
- **CI execution:** GitHub-hosted Ubuntu Actions runners in the target repository. DiffHarbor does not download and store source archives on its Worker.
- **Identity/integration:** GitHub App OAuth for the human session; GitHub App installation tokens for repository API and workflow dispatch; signed webhooks for GitHub events; GitHub Actions OIDC for report publication.
- **Cryptography:** Cloudflare Web Crypto APIs for HMAC session signatures, AES-GCM token encryption, App JWT signing, webhook HMAC validation, and OIDC JWT verification.

### Local or self-hosted path

The repository also has a Python FastAPI service under backend/app, SQLAlchemy models and Alembic migrations, PostgreSQL, Redis, and ARQ jobs. Docker Compose provisions PostgreSQL 18 and Redis 8.2 for local use. The Python package declares Python 3.14+. This path is an alternate implementation, not the backing API for the Cloudflare workers.dev deployment.

### Relevant configuration and source files

| Path | Responsibility |
| --- | --- |
| frontend/src/App.tsx | SPA routes, GitHub-authenticated data fetching, sample data, dashboard, comparison summaries, theme, activity and run-detail views |
| frontend/src/TuliExplainer.tsx | Five-scene in-page animated explainer, captions, controls, optional browser text-to-speech |
| frontend/src/styles.css | Responsive dashboard and light/dark theme styling |
| cloudflare/src/index.ts | Worker routes, OAuth, signed sessions, token encryption, GitHub API calls, webhook handling, queue dispatch, report verification, D1 reads/writes |
| cloudflare/wrangler.jsonc | Worker name, asset binding, D1 binding, queue producer/consumer and deployment variables |
| cloudflare/migrations/0001_initial.sql | Hosted D1 schema and indexes |
| integrations/github/runner.py | Reads trusted base config, validates checkout SHAs, runs checks on both trees, classifies comparisons, emits report |
| integrations/github/analyzer.py | Python AST import graph, affected-importer traversal, supported route-decorator extraction |
| integrations/github/templates/changeguard.toml | Target-repository example configuration |
| integrations/github/templates/changeguard-workflow.yml | GitHub Actions workflow template |
| backend/app | Separate FastAPI/PostgreSQL/Redis implementation |
| docs/judge-guide.md | Judge onboarding, constraints, data handling, safety and FAQs |
| docs/live-service-setup.md | Cloudflare and GitHub App setup |
| docs/hackathon-demo.md | Failure/fix demo story and recording outline |

## Python analysis algorithm

The analyzer is deliberately static and bounded:

1. Recursively enumerate candidate checkout Python files while skipping virtual environments, Git metadata, node_modules, caches, build, and distribution directories.
2. Ignore symlinked files, source files over 1 MB, and stop after 5,000 source files.
3. Parse source with Python's ast module. Syntax errors are collected as bounded parse-error records.
4. Convert file paths to Python module names and resolve common absolute and relative import forms against modules found in the checkout.
5. Build reverse import edges: an edge identifies a module that imports another module.
6. Seed a breadth-first traversal with changed Python modules, then follow reverse edges to find likely importers. The resulting set represents files that may depend on changed code.
7. For affected files, recognize function or async-function decorators shaped like calls to common HTTP methods such as get/post/put/patch/delete/route with a literal path argument.
8. Return changed files, affected files, route records with method/path/function/file/line, parse errors, and medium confidence.

This is not a runtime call graph. Dynamic imports, reflection, generated code, framework-specific route registration, string-built paths, indirect behavior, non-Python services, and calls across language boundaries are outside its coverage.

## Runner configuration and execution model

The example TOML config is loaded from the base commit rather than the candidate. That prevents a proposed change from silently removing or weakening the checks used to evaluate itself. It sets the Python version and declares shell commands.

The current runner bounds configuration size to 128 KiB, checks to 20, command length to 2,000 characters, a command timeout to 15 minutes, and the aggregate rehearsal deadline to 30 minutes. Captured output is truncated to 5,000 characters per result and passed through simple token/password-like redaction patterns. The report endpoint rejects bodies above 512 KiB. The workflow compresses and base64-encodes the report between jobs and bounds the output size.

Each configured install, optional setup, check, and cleanup command is executed separately in the base tree and candidate tree. Check directories are resolved and rejected if they escape the checkout. Commands execute through Bash with shell=True; therefore the commands are powerful and must be treated as trusted repository configuration. The workflow's standard template provisions Python. For Node, Java, Go, or another ecosystem, the repository owner must customize runtime setup and the configured commands. The current analyzer still only understands Python.

The runner checks that Git reports the exact base/head SHAs expected by the webhook before doing work. Its control script is checked out from the target default branch, apart from candidate code. The rehearsal job grants contents:read and does not grant OIDC token minting. The runner also removes known GitHub token and OIDC endpoint variables from the subprocess environment that executes candidate commands. The separate publisher job has id-token:write and transmits the report. Candidate code still runs on a hosted runner and retains network access; this design is not a sandbox for hostile public code.

## Hosted API and D1 data model

Main API surfaces in the Worker:

| Method and path | Function |
| --- | --- |
| GET /api/health | Basic service status |
| GET /api/github/status | App setup status and installation URL |
| GET /api/auth/status | OAuth/session configuration status |
| GET /api/auth/github/login | Start GitHub OAuth with random state cookie |
| GET /api/auth/github/callback | Validate state, exchange code, save identity/token, establish session |
| GET /api/auth/me | Return the signed-in GitHub profile |
| POST /api/auth/logout | Revoke/clear OAuth credentials where possible and expire session |
| GET /api/runs | List runs for public repositories accessible through the user's installations |
| GET /api/runs/{uuid} | Read a run and evidence after repository-access checks |
| POST /api/github/webhook | Verify and process GitHub webhook events |
| POST /api/runs/{uuid}/report | Verify signed Actions identity and store bounded report |

Hosted tables:

- github_users: GitHub numeric ID, login/profile, encrypted access/refresh token material and expiry timestamps.
- github_installations: installation ID, owner/account metadata, repository selection and active state.
- rehearsal_runs: repo/PR/base/head identity, status, workflow ID/link, check-result JSON and impact JSON. Unique constraint on repository ID + PR number + head SHA; indexes support repository timeline and status queries.
- findings: categorized/severity/confidence/title/description/file/line/evidence records linked to a run.
- webhook_deliveries: GitHub delivery ID/event/action/run ID for duplicate delivery handling.

The Worker validates the GitHub Actions OIDC token against GitHub's published JWKS, expected issuer, RS256 algorithm, audience diffharbor, time claims, repository ID/name, workflow_dispatch event, default-branch ref and expected workflow_ref. It then calls GitHub to confirm that run ID is actually the expected workflow path/title/branch/event. Finally, it checks the report's run ID and base/head SHAs against the persisted PR event before accepting evidence.

## Authentication and authorization

- Human sign-in is GitHub OAuth. Login creates a cryptographically random state value, stores it in a short-lived HttpOnly, SameSite=Lax cookie scoped to the callback path, and requires an exact state match on callback.
- The Worker signs an eight-hour user-session payload with HMAC-SHA-256. The browser session cookie is HttpOnly and SameSite=Lax; it receives Secure on HTTPS.
- GitHub OAuth access and refresh tokens are encrypted before D1 persistence using AES-GCM with a 256-bit encryption key and a fresh 96-bit nonce for each encryption.
- GitHub App private key and OAuth/webhook/session/encryption secrets are Cloudflare secrets, not repository config.
- Installation tokens are requested for Actions write, Contents read, and Pull Requests read. The App dispatches a workflow; it does not write source contents.
- API run queries derive accessible repository IDs from the signed-in user's GitHub App installations and filter to public repositories.
- Fork PRs are recorded as approval_required. A review event only releases that run when an approved review targets the current head SHA and GitHub confirms the reviewer has write or admin permission on the base repository.
- Webhook signatures use HMAC-SHA-256; body size is bounded and delivery IDs are deduplicated.

## Dashboard behavior

The routes are / (Pull requests), /impact, /activity, /help, and /runs/{id}; sample equivalents live under /demo. The dashboard provides:
- A first-connection or sample-rehearsal view and repository setup steps.
- Check-by-check base versus candidate outputs and a plain-language result summary.
- Distinct new failure, pre-existing failure, fixed, passing, and inconclusive labels.
- An Impact page with changed/affected Python files and recognized routes.
- An Activity page and a detail report for an individual run, including workflow link and evidence.
- Light/dark theme preference saved in browser local storage.
- Help and FAQ navigation plus the Tuli five-scene animated guide. Its optional narration uses browser speech synthesis; it is not a separate video file.

The read-only /demo branch of the UI uses hard-coded fictional data in the frontend and does not fetch GitHub accounts, repositories, or saved runs. The live signed-in path reads API evidence. Do not describe fictional data shown in /demo as a real customer run.

## Technology stack

| Layer | Technology |
| --- | --- |
| Browser UI | React 19, TypeScript 7, Vite 8, lucide-react |
| Hosted API | Cloudflare Workers, TypeScript, Web Crypto |
| Hosted relational storage | Cloudflare D1 |
| Background work | Cloudflare Queues |
| Git hosting and identity | GitHub App, OAuth, webhooks, REST API, Actions, OIDC |
| Check/analysis tool | Python 3, standard library ast/tomllib/subprocess/pathlib |
| Local alternate API | Python 3.14+, FastAPI, Pydantic Settings, SQLAlchemy async, Alembic, asyncpg |
| Local queue/cache | Redis, ARQ |
| Local relational storage | PostgreSQL |
| Local services | Docker Compose |
| Worker tooling | Node.js 24, npm, Wrangler 4 |

Exact npm dependency versions are pinned in frontend/package-lock.json and cloudflare/package-lock.json. The hosted path and local path are separate deployments with distinct database and queue implementations.

## Scope, constraints, and risks to state accurately

1. **Provider:** GitHub.com only. This is a GitHub pull-request integration, not a generic GitLab/Bitbucket CI platform.
2. **Repository privacy:** Hosted execution and visible run queries are limited to public repositories. This is part of the cost boundary.
3. **Language coverage:** Python is the only language with a built-in impact map. Other tests can be invoked by custom shell commands only after the target workflow installs/provides the runtime. This is not universal out-of-the-box language support.
4. **Configuration required:** Each target repository needs the TOML config and workflow file on the default branch. GitHub Actions must be enabled.
5. **Trust model:** Candidate code and shell checks run on GitHub-hosted runners and can access the network. No production secrets are supplied by the template, but network access remains. Only connect repositories whose code and configured commands you trust.
6. **Output/privacy:** DiffHarbor stores metadata and generated report evidence, including commit IDs, PR text, paths, routes, finding text, and bounded output excerpts. It does not store source archives. Current preview has no self-service history deletion or automatic report expiry.
7. **No release authority:** The app does not merge, change repository contents, promote a build, or deploy the target application. Existing review and release controls remain responsible.
8. **Not log observability:** It does not parse production logs or replace monitoring, alerting, tracing, or Linux log navigation.
9. **Not AI:** The current comparisons and Python impact map are deterministic. There is no AI chat or model-generated diagnosis in this implementation.
10. **Free-tier availability:** Deployment is configured for Cloudflare Free and public GitHub Actions runners. Free-tier quotas and provider policy apply; this is a hackathon preview without a production SLA. Never promise zero downtime or unlimited use.
11. **Impact confidence:** Static imports and supported decorators provide hints, not a proof of all runtime effects or a complete call graph.
12. **No local setup for the public demo:** Judges can explore /demo in a browser. To rehearse their own real repository, they need a GitHub account, permission to install the public App, a public repository, and the two config/workflow files. No local Docker/Python/Node setup is needed for that hosted use.

## Two-minute video plan

Prefer a screen recording or simple 2D animation using the real UI and the linked failure/fix example. Keep the sequence legible; do not cram provider configuration or source code onto screen. If showing /demo, visibly label it fictional sample data. If claiming a real run, show the linked repository's actual pull request and Actions run.

### Timed visual beats

- **0:00–0:15 — Pain:** A developer is about to merge a small backend change and worries about hidden regressions.
- **0:15–0:32 — Connect:** Show a pull request and explain that the public GitHub App watches supported PR events in an opted-in public repo.
- **0:32–0:52 — Rehearse:** Animate two parallel lanes: exact base commit and exact candidate commit; same configured checks on each.
- **0:52–1:12 — Catch:** Show the example where a score exceeds its 100-point cap; the configured test passes on base and fails on candidate, producing a new-failure label.
- **1:12–1:28 — Fix:** Show the follow-up commit and passing check; explain the dashboard's new, existing, fixed, passing, and inconclusive distinctions.
- **1:28–1:43 — Impact:** Show changed Python module → likely importers → recognized route. State that other stacks can run custom checks with their runtime, but do not get an impact map.
- **1:43–1:55 — Guardrails:** Mention public repositories, trusted candidate code, and that DiffHarbor reports evidence only.
- **1:55–2:00 — Decision:** Reviewer decides whether to merge; normal deployment pipeline decides what goes live.

### Narration draft (~250 words)

“Backend releases can be risky: a small pull request may break behavior outside the file being edited. DiffHarbor gives a team a rehearsal before merging.

A developer installs the public GitHub App on a public repository, adds a small configuration file and workflow, then opens a pull request. GitHub sends the change to DiffHarbor. The service records the exact base and proposed commit IDs, then queues a GitHub Actions run.

The runner checks out both revisions and uses the same configuration to run the same chosen checks on each. In our example, the current version passes, but the proposed change lets a risk score go above its limit. A test expects a maximum of 100 and catches 111. The dashboard labels that as a new failure.

After the limit is restored, the check passes. DiffHarbor shows the fix and keeps failures that already existed on the base version separate from new ones. Reviewers can open the check output and the original GitHub Actions run.

For Python projects, DiffHarbor also maps changed modules to likely importers and supported API routes. This is a static guide, not a complete picture of runtime behavior. Other languages can run configured checks when their workflow supplies the right runtime, but they do not get an impact map yet.

The hosted flow is limited to public GitHub repositories. Candidate code runs on a hosted runner and still has network access, so teams should connect only code they trust. DiffHarbor does not merge or deploy. It presents evidence; the team decides what to accept.”

### Prompt to give a video-generation or editing model

“Use the attached DiffHarbor technical handoff as the source of truth. Create a polished, simple, minimal two-minute 16:9 explainer for backend developers and hackathon judges. Use a calm, optimistic 2D guide character named Tuli, restrained navy/teal/purple accents, readable large labels, and clean transitions. Show a pull request splitting into two exact revisions labelled BASE and CANDIDATE; run the same checks on both; show one test passing before and failing after with 100 expected versus 111 actual; show a follow-up fix pass; then show a Python change-impact map from changed module to importer and recognized route; finish with a human reviewer choosing what to do. Use the narration draft without adding unsupported capabilities. Add clear on-screen scope labels: public GitHub repos only for hosted checks; Python impact map only; other language checks require custom runtime setup; /demo contains fictional data; DiffHarbor does not merge or deploy; reviewers decide. Do not show real secrets, claim all-language impact analysis, imply AI analysis, claim production log monitoring, or suggest the deployment is automated by DiffHarbor. Use actual UI screenshots from docs/assets/dashboard-help.jpg and the live demo if available. Keep text large and scenes uncluttered. End with the live demo and repository links.”

## Repository state and validation notes

At the inspected starting point, local main and origin/main were aligned at commit 93ef3ae. The working tree had an untracked dashboard screenshot at docs/assets/dashboard-help.jpg and an untracked output directory containing a local PDF; neither was part of that commit. Do not add output or environment files to the repository. backend/.env is ignored and must remain private.

This handoff is based on source/document inspection. No test suite or production smoke test was run while preparing it. Check the linked live service and PR/Actions results immediately before recording, since deployments, provider quotas, and external status can change.
