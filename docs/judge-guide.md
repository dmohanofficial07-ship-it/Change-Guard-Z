# DiffHarbor judge guide: scope, constraints, and FAQs

Last reviewed: 31 October 2026

This guide explains what the live hackathon preview does, what it does not do, the setup a judge needs, and the limits that affect a real run. DiffHarbor is a change-rehearsal tool: it checks a proposed pull request and reports evidence for a person to review.

## Quick ways to see the project

- [Open the read-only dashboard demo](https://diffharbor-live.diffharbor-cloudflare.workers.dev/demo). No GitHub sign-in or local setup is needed. The runs shown here are fictional sample data.
- [Open the short animated walkthrough](https://diffharbor-live.diffharbor-cloudflare.workers.dev/demo/help). On the Help page, select **Play explainer**; captions are always visible, and optional narration uses the browser's built-in speech.
- [Open the real failure-and-fix pull request](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2) and its [failed rehearsal](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048481590) and [fixed rehearsal](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048764900). This is the real example behind the demo story.
- [Open the live workspace](https://diffharbor-live.diffharbor-cloudflare.workers.dev). Connecting a judge's own repository requires a GitHub account and the setup below. It does not require installing Python, Docker, PostgreSQL, or Node on the judge's computer.

### Current GitHub App access

As checked on 31 October 2026, the [ChangeGuard Northstar GitHub App](https://github.com/apps/changeguard-northstar) is **public**. Judges can [start installing it](https://github.com/apps/changeguard-northstar/installations/new) on a public repository they own or are allowed to connect. They review the requested permissions and choose which repositories to connect; organization installations may require an organization owner’s approval. GitHub says a public app cannot be made private while it is installed on other accounts. [GitHub visibility instructions](https://docs.github.com/en/apps/maintaining-github-apps/modifying-a-github-app-registration)

Public visibility makes the app installable by other GitHub accounts; it does not publish its private key. At installation time, each account reviews the permissions and selects which repositories to connect. Organization installations may require an organization owner to approve the app. [GitHub App installation guide](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)

## What happens in a real rehearsal

1. A user signs in with GitHub and installs the app on a public repository they own or are allowed to connect. Python is the fully validated analyzer path; other languages can supply custom test commands and runtime setup.
2. The repository's default branch contains `changeguard.toml` and `.github/workflows/changeguard.yml`. The TOML file lists the checks the repository wants to run.
3. A non-draft pull request triggers a rehearsal. Same-repository pull requests are dispatched automatically. A pull request from a fork waits for an approval by a repository collaborator with write or admin permission, for the current head commit.
4. GitHub Actions checks out the base and proposed commits on a temporary GitHub-hosted runner and runs the configured checks against both.
5. The dashboard shows check comparisons and a static Python impact map. A person decides what to do next. DiffHarbor does not merge the pull request or deploy to production.

## Constraints and their practical effect

| Constraint | Current behavior | What a judge should expect |
| --- | --- | --- |
| GitHub provider | The hosted service uses a GitHub App, GitHub OAuth, GitHub webhooks, and GitHub Actions. It is not a GitLab, Bitbucket, or GitHub Enterprise Server integration. | Use a GitHub.com account and repository. |
| App visibility | The app is public as of 31 October 2026. | Judges can install it, review the permissions, and select repositories. |
| Repository visibility | The hosted worker only queues pull requests from public repositories. Private repositories are not processed in the no-cost preview. | Use a public repository. This boundary keeps checks on GitHub's standard public-repository runners. |
| Language support | The runner compares configured shell commands on the base and candidate commits. The workflow includes a Python helper runtime; another language may run if its runtime is available or added to the target workflow. | Python is the only fully validated analyzer path. Other-language tests may run with custom setup, but DiffHarbor does not map their files, imports, or routes. Do not describe this release as turnkey support for every language. |
| Python impact map | The analyzer parses Python ASTs, follows statically recognizable imports, and looks for common decorator-based HTTP routes. | Dynamic imports, runtime wiring, generated routes, and behavior that cannot be inferred from syntax may be missed. The map is useful review evidence, not proof of runtime behavior. |
| Repository setup | The default branch must contain `changeguard.toml` and the workflow template at `.github/workflows/changeguard.yml`. The check configuration is read from the pull request's base commit. | Add and commit these files before opening the pull request. The PR cannot remove its own checks by changing its copy of the TOML file. |
| Configured commands | The repository owner chooses shell commands in the base-branch TOML file. There must be 1–20 checks; the TOML file is at most 128 KiB; a command is at most 2,000 characters. | Only install the app on a repository whose code and check commands you trust. Commands are executable code, not declarative test names. |
| Time and output | Each command has a 15-minute maximum; the baseline and candidate checks share a 30-minute runner budget. Logs are limited to the last 5,000 characters per command after best-effort redaction. The report is limited to 512 KiB raw and 480,000 characters when compressed/base64-encoded for publishing. | Long test suites or very large reports can time out or fail to publish. Split or optimize checks if they exceed the limits. |
| Analyzer scale | The impact analyzer examines at most 5,000 Python files, skips individual files larger than 1 MB, and caps returned changed/affected paths, routes, and parse errors. | Very large repositories may have an incomplete impact map; parse and size limitations are surfaced in the evidence where possible. |
| Fork pull requests | Fork runs are recorded as awaiting approval. An approved review must belong to the current head commit, and the reviewer must have write or admin permission on the base repository. | A contributor cannot trigger checks on a fork merely by opening a pull request. A maintainer must review and approve the exact current commit. |
| Candidate code safety | Candidate code runs in a separate GitHub Actions job without production secrets, a persisted checkout credential, or an OIDC token. The runner removes GitHub token variables from the check subprocess. Candidate code still has network access and can execute arbitrary commands from the repository's configured checks. | Treat candidate code as untrusted. Use repositories you trust; do not configure production secrets in these checks. Log redaction only catches common patterns and is not a guarantee that sensitive output is removed. |
| Report verification | GitHub webhooks are signature-checked and deduplicated. The report publisher uses a short-lived GitHub Actions identity token; the worker checks its signature, repository, workflow, default branch, event, and run with GitHub before storing the report. | A report is accepted only for a tracked run from the expected repository workflow. This validates where the report came from; it does not prove that a test suite is complete or correct. |
| Data stored | D1 stores GitHub account metadata, installation state, repository/PR metadata, commit SHAs, run status, impact data, findings, and check-output excerpts. OAuth tokens are stored encrypted. Source archives are checked out by GitHub Actions and are not stored in the DiffHarbor database. | Reports can contain repository paths, route names, PR titles, and snippets of check output. Do not include secrets in test output. |
| Retention | The current preview has no self-service deletion or automatic expiry for run history. Signing out clears the saved OAuth token, but does not erase the account or run history. Uninstalling the app marks its installation inactive; it does not automatically delete the old reports. | Do not connect sensitive, regulated, or confidential repositories to this hackathon preview. The operator must manually remove retained records when needed. |
| Automation scope | DiffHarbor reports evidence. It does not merge PRs, write source files, promote a release, or deploy production code. | Your normal reviewer and deployment process remains in control. |
| AI scope | The current analyzer is deterministic Python syntax/import analysis plus the repository's configured checks. It does not use an AI model or AI chat. | Results are repeatable and tied to check output; there is no AI-generated diagnosis in this version. |

## Free-service limits

The hosted preview is configured for Cloudflare Free and GitHub's standard hosted runners for public repositories. The figures below were checked against the provider documentation on 31 October 2026; provider limits can change.

| Service | Current free limit used by this project | If the limit is reached |
| --- | --- | --- |
| Cloudflare Workers | 100,000 requests per account per day and 10 ms CPU time per HTTP request. | Worker requests can fail until the daily request allowance resets. A CPU-heavy request can be terminated. |
| Cloudflare D1 | 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage. | D1 queries fail after daily read/write limits are exceeded until reset; at storage capacity, new writes can fail. |
| Cloudflare Queues | 10,000 operations/day; free-plan message retention is 24 hours. | Repeated queue traffic or retries consume operations; queued messages that remain unprocessed beyond retention can expire. |
| GitHub Actions | Standard GitHub-hosted runners are free and unlimited for public repositories under GitHub's current policy. | The target repository must allow Actions and comply with GitHub's policies. Private-repository runner billing is deliberately avoided by the public-only restriction. |

The Cloudflare account must remain on the Free plan to preserve the no-cost claim. This is a small hackathon preview, not a production SLA: quota exhaustion can make API calls, reports, or check dispatch unavailable until limits reset. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/) · [Queues pricing and retention](https://developers.cloudflare.com/queues/platform/pricing/) · [GitHub Actions runner billing](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

## Questions judges may ask

### Does the demo need a GitHub account?

No. `/demo` is read-only and uses fictional results. GitHub sign-in is required for the live workspace and real repository runs.

### Can I try my own repository without installing local software?

Yes. The GitHub App is public. The work happens through the browser and GitHub.com: sign in, install the app on a public repository, add the two setup files to its default branch, and open a PR. No local Docker, database, Python environment, or Node setup is required for a judge. Use Python to see the full impact map; another language needs custom runtime setup and will show check comparisons only.

### Does it work with JavaScript, Java, Go, or another language?

The runner executes the shell commands in `changeguard.toml`, so a repository may run its own tests if the target workflow makes the needed runtime available. For example, the command could be `npm test`, `go test ./...`, or `mvn test`. The provided workflow is Python-centered, so another stack may need a workflow setup step for its runtime. DiffHarbor's impact analysis currently understands Python only; it does not yet trace JavaScript, Java, Go, or other languages. This is partial custom-check compatibility, not universal language support.

### What permissions does the app request, and why?

- **Contents: read** — read repository files and commits needed by the integration.
- **Pull requests: read** — receive and inspect PR metadata and current commit SHAs.
- **Actions: write** — dispatch the repository's workflow. It does not give the app permission to write repository contents.

Review the permission screen before installing. Choose only repositories you want to connect. [GitHub explains repository selection and permission review here](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party).

### What do “new failure,” “already failing,” and “fixed” mean?

DiffHarbor runs the same configured checks on the base commit and the PR commit. A check that passes on base and fails on the PR is a new failure. If it fails on both, it is pre-existing. If it fails on base and passes on the PR, the change fixed it. A timeout or skipped check is inconclusive, not a pass.

### Is the impact map a complete call graph?

No. It is a static Python import graph plus route decorators that the analyzer recognizes. It does not execute the app to discover runtime behavior and cannot fully understand reflection, dynamic imports, generated code, or cross-language calls. Treat it as evidence to guide review, not an exhaustive proof.

### Does it use AI, merge the pull request, or deploy the app?

No to all three in this release. Analysis and comparison are deterministic. A human decides whether to merge; a separate deployment pipeline remains responsible for production.

### Does DiffHarbor analyze production application logs?

No. It addresses the risk of introducing a bug through a proposed code change. It rehearses a GitHub pull request before merge; it does not browse Linux log files, monitor a running service, or replace production observability tools.

### Why use DiffHarbor if the repository already has CI?

It reuses the repository's configured checks and compares their results on both the base and candidate commits. It adds a Python impact map and a plain-language comparison so reviewers can distinguish a new failure from one that was already present. It complements CI; it does not replace it.

### Can a team in another IT sector use it?

The review workflow—check a proposed change before release—can help teams in many sectors. This implementation is narrower: GitHub.com pull requests, public repositories, and a Python analyzer. It is not currently a universal analyzer for every language, service, or deployment platform.

### What happens if a check fails or the report is incomplete?

The dashboard shows candidate failures, pre-existing failures, fixes, passes, and inconclusive checks separately. A timeout, unsupported config, parse error, or oversized report can make evidence incomplete. Review the base and candidate logs and the linked GitHub Actions run before deciding.

### Is it safe to run on any public repository?

Only connect a repository you trust. Its configured shell commands execute against the candidate code. The workflow avoids passing production secrets and isolates report publishing, but candidate code has network access; this is not a hostile-code sandbox. The service is a hackathon preview and is not suitable for confidential or regulated code.

### Where does code and report data go?

GitHub Actions checks out the base and candidate source on a GitHub-hosted runner. DiffHarbor D1 stores metadata and the generated report: commit IDs, changed and affected paths, route information, result summaries, findings, and bounded output excerpts. OAuth tokens are encrypted at rest. There is currently no automatic report expiry or self-service history deletion.

### What if a free quota is exceeded?

The project can return errors, stop accepting database work, or leave a run waiting/failed until the provider quota resets. The preview does not upgrade itself to a paid plan. The limits should be monitored before a live judge session.

### Can an organization connect its repo?

Potentially, if it is a public repository and an organization owner permits the app installation. Python gets the full impact map; other languages need configured runtimes and receive check comparisons only. Organization policies may require approval. DiffHarbor does not override those GitHub controls.

## Provider references

- [Making a GitHub App public or private](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare Queues pricing and retention](https://developers.cloudflare.com/queues/platform/pricing/)
- [GitHub Actions public runner usage](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
