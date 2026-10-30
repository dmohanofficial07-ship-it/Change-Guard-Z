# ChangeGuard hackathon demo

## The story

ChangeGuard checks a proposed backend change before a team accepts it. This demo shows a real example: a transaction-risk score loses its 100-point limit, the existing backend test catches it, and the next commit restores the limit. ChangeGuard reports the failure and then the recovery. The pull request stays open; no change is merged or deployed.

## Links

- [ChangeGuard source](https://github.com/dmohanofficial07-ship-it/Change-Guard-Z)
- [Unmerged demo pull request #2](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2)
- [ChangeGuard rehearsal that caught the regression](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048481590)
- [Backend CI run that failed on the regression](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048482653)
- [ChangeGuard rehearsal after the fix](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048764900)
- [Backend CI after the fix](https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/actions/runs/41048765198)

## 90-second walkthrough

**0:00–0:15 — The problem**

“When backend changes are checked manually or directly against a live system, a small mistake can disrupt normal work. ChangeGuard gives the team a rehearsal before they accept a change.”

**0:15–0:30 — The proposed change**

Open pull request #2 and show its commit history. Explain that one commit temporarily removed the score limit and the next restored it. Keep the pull request unmerged.

**0:30–0:50 — The failure**

Open the failed ChangeGuard rehearsal and the backend CI run. Point out that the backend test failed because the score went above 100, while the container build passed. ChangeGuard reports the candidate result; it does not merge or deploy code.

**0:50–1:10 — The fix**

Show the follow-up commit that restores the limit and the checks for that commit. Wait for the latest ChangeGuard and CI runs to complete before recording this section, then show their final results.

**1:10–1:30 — The dashboard and scope**

Show the ChangeGuard dashboard report: checks, impacted code, and any findings. Close with: “Today this version supports Python backends. Other languages need their own analyzer and checks. A person still decides whether to merge, and the repository’s separate deployment process controls what goes live.”

## Before recording

- Sign in to the dashboard and open the demo pull request in another tab.
- Confirm the fixed commit's CI and ChangeGuard runs have completed; use their latest results.
- Keep the pull request open and do not click Merge.
- Record a real Wispr Flow usage card from your account for the hackathon submission. Do not claim or invent usage numbers in the video.
- Keep the video within the event's stated time limit.
