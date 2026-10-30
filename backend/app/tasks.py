from uuid import UUID

from sqlalchemy import select

from app.db import SessionFactory
from app.github_api import GitHubAPIError, dispatch_rehearsal_workflow
from app.models import RehearsalRun
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


class WorkerSettings:
    functions = [dispatch_rehearsal]
    job_serializer = serialize_job
    job_deserializer = deserialize_job
    max_jobs = 8
    job_timeout = 120
