from uuid import UUID

from sqlalchemy import delete, select

from app.db import SessionFactory
from app.github_api import GitHubAPIError, dispatch_rehearsal_workflow, download_rehearsal_report
from app.models import Finding, RehearsalRun
from app.queue import deserialize_job, serialize_job
from app.settings import get_settings


async def dispatch_rehearsal(ctx: dict, run_id: str) -> None:
    run_uuid = UUID(run_id)
    async with SessionFactory() as session:
        run = await session.scalar(select(RehearsalRun).where(RehearsalRun.id == run_uuid))
        if run is None or run.status not in {"queued", "dispatching"}:
            return
        run.status = "dispatching"
        run.failure_reason = None
        await session.commit()

        settings = get_settings()
        try:
            result = await dispatch_rehearsal_workflow(
                installation_id=run.installation_id,
                owner=run.repository_owner,
                repository=run.repository_name,
                default_branch=run.default_branch,
                workflow_file=settings.github_workflow_file,
                run_id=str(run.id),
                pull_request_number=run.pull_request_number,
                base_sha=run.base_sha,
                head_sha=run.head_sha,
            )
            await session.refresh(run)
            if run.status == "dispatching":
                run.status = "queued"
            if result["workflow_run_id"] is not None:
                run.workflow_run_id = result["workflow_run_id"]
            if result["run_url"]:
                run.workflow_url = result["run_url"]
        except Exception as exc:
            await session.refresh(run)
            if run.status == "dispatching":
                run.status = "failed"
                run.failure_reason = (str(exc) if isinstance(exc, GitHubAPIError) else "Could not dispatch the GitHub Actions workflow.")[:1000]
        await session.commit()


async def collect_report(ctx: dict, run_id: str) -> None:
    run_uuid = UUID(run_id)
    async with SessionFactory() as session:
        run = await session.scalar(select(RehearsalRun).where(RehearsalRun.id == run_uuid))
        if run is None or run.workflow_run_id is None:
            return
        try:
            report = await download_rehearsal_report(
                installation_id=run.installation_id,
                owner=run.repository_owner,
                repository=run.repository_name,
                workflow_run_id=run.workflow_run_id,
                run_id=str(run.id),
            )
            check_results = report.get("checks", []) if isinstance(report, dict) else []
            impact = report.get("impact", {}) if isinstance(report, dict) else {}
            report_findings = report.get("findings", []) if isinstance(report, dict) else []
            if not isinstance(check_results, list) or not isinstance(impact, dict) or not isinstance(report_findings, list):
                raise GitHubAPIError("The rehearsal report did not match the expected structure.")

            run.check_results = check_results[:100]
            run.impact = impact
            run.failure_reason = None
            await session.execute(delete(Finding).where(Finding.run_id == run.id))
            for item in report_findings[:500]:
                if not isinstance(item, dict):
                    continue
                try:
                    confidence = max(0.0, min(1.0, float(item.get("confidence", 0.5))))
                except (TypeError, ValueError):
                    confidence = 0.5
                line_start = item.get("line_start")
                session.add(
                    Finding(
                        run_id=run.id,
                        category=str(item.get("category", "verification"))[:40],
                        severity=str(item.get("severity", "info"))[:16],
                        confidence=confidence,
                        title=str(item.get("title", "Rehearsal finding"))[:300],
                        description=str(item.get("description", ""))[:5000],
                        file_path=str(item["file_path"])[:2000] if item.get("file_path") else None,
                        line_start=int(line_start) if isinstance(line_start, int) and line_start > 0 else None,
                        evidence=item.get("evidence") if isinstance(item.get("evidence"), dict) else {},
                    )
                )
            await session.commit()
        except Exception as exc:
            run.failure_reason = (str(exc) if isinstance(exc, GitHubAPIError) else "Could not collect the rehearsal report artifact.")[:1000]
            await session.commit()


class WorkerSettings:
    functions = [dispatch_rehearsal, collect_report]
    job_serializer = serialize_job
    job_deserializer = deserialize_job
    max_jobs = 8
    job_timeout = 120
