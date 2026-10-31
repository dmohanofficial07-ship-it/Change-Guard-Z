# DiffHarbor hackathon demo

## The story

DiffHarbor checks a proposed backend change before a team accepts it. This demo shows a real example: a transaction-risk score loses its 100-point limit, the existing backend test catches it, and the next commit restores the limit. DiffHarbor reports the failure and then the recovery. The pull request stays open; no change is merged or deployed.

## Links

- [DiffHarbor source](https://github.com/dmohanofficial07-ship-it/Change-Guard-Z)
- [Cloudflare live dashboard](https://diffharbor-live.diffharbor-cloudflare.workers.dev): use `/` for GitHub sign-in and real public-repository runs, or `/demo` for the fictional, read-only walkthrough.
- [Judge guide: constraints, setup, safety, and FAQs](judge-guide.md)
- [Unmerged demo pull request #2](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2)
- [DiffHarbor rehearsal that caught the regression](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048481590)
- [Backend CI run that failed on the regression](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048482653)
- [DiffHarbor rehearsal after the fix](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048764900)
- [Backend CI after the fix](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048765198)

## 2-minute walkthrough

**0:00–0:20 — The problem**

“A small backend change can break a route or return the wrong result. Teams often discover that after merging or by manually testing a live system. DiffHarbor gives them a rehearsal before they accept a change.”

**0:20–0:40 — The proposed change**

Open pull request #2 and show its commit history. Explain that one commit temporarily removed the risk score limit and the follow-up commit restored it. Keep the pull request unmerged.

**0:40–1:05 — The failure**

Open the failed DiffHarbor rehearsal and the backend CI run. Point out that the backend test failed because the score went above 100, while the container build passed. Show how the dashboard separates the new failure from checks that still pass.

**1:05–1:25 — The fix**

Show the follow-up commit that restores the limit and the checks for that commit. Wait for the latest DiffHarbor and CI runs to complete before recording this section, then show their final results.

**1:25–1:50 — The dashboard and scope**

Show the dashboard's impact map, check comparison, Activity page, and Help & FAQ. Explain that the hosted preview supports public Python repositories and does not merge or deploy. A person still makes the release decision.

**1:50–2:00 — Close**

“DiffHarbor makes the possible impact and check evidence easier to review before a change is merged. The live demo and all current limits are documented in the repository.”

## Before recording

- Sign in to the dashboard and open the demo pull request in another tab.
- For judges, use the deployed `/demo` link; it shows fictional data without GitHub sign-in and does not depend on a local computer.
- Confirm the fixed commit's CI and DiffHarbor runs have completed; use their latest results.
- Keep the pull request open and do not click Merge.
- Record a real Wispr Flow usage card from your account for the hackathon submission. Do not claim or invent usage numbers in the video.
- Keep the video within the event's stated time limit.
