# No Hands challenge submission draft

**Track:** Builders

**Project:** DiffHarbor

**Project link:** https://github.com/dmohanofficial07-ship-it/Change-Guard-Z

**Demo video:** Record the walkthrough in [hackathon-demo.md](hackathon-demo.md), within the event's two-minute limit.

**Live project link:** Add the Cloudflare Worker URL after deploying the live service (sign in and connect a public repository to show real data).

**Sample walkthrough:** The same Cloudflare Worker URL with `/demo` shows the read-only fictional example. The existing Render Static Site from `render.yaml` remains a separate sample host.

## Project explanation

Backend engineers often have to check changes to older services without a safe rehearsal environment. DiffHarbor connects to GitHub pull requests, maps changed Python code to related files and routes, and runs the repository's approved checks against the current and proposed versions on a temporary GitHub Actions runner. It puts the evidence in a dashboard so the team can fix problems before accepting a change. The engineer still decides whether to merge, and the repository's own deployment process controls what goes live.

In our demonstration, removing a 100-point transaction-risk score limit caused an existing backend test to fail. Restoring the limit made both the backend CI and DiffHarbor rehearsal pass. The pull request remains open and unmerged.

## How I used Wispr Flow

I used Wispr Flow to describe the work problem, dictate requirements, and give follow-up instructions while building with my coding assistant. I will attach my actual usage-card screenshot from Wispr Flow Insights.

## Final checks before submission

- Add the judge-accessible Cloudflare Worker URL and confirm both `/` and `/demo` load.
- Attach a demo video under two minutes.
- Attach the usage card screenshot from the desktop app's Insights page.
- Confirm the project and explanation match what you actually built and dictated.
