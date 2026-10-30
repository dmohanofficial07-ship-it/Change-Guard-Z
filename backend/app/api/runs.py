from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user, get_accessible_installation_repositories
from app.db import get_session
from app.models import Finding, GitHubUser, RehearsalRun
from app.schemas import RunDetailResponse, RunResponse

router = APIRouter(prefix="/api/runs", tags=["rehearsal runs"])


@router.get("", response_model=list[RunResponse])
async def list_runs(
    user: GitHubUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[RehearsalRun]:
    installations = await get_accessible_installation_repositories(user, session)
    repository_ids = {repository_id for repositories in installations.values() for repository_id in repositories}
    if not repository_ids:
        return []
    result = await session.scalars(
        select(RehearsalRun)
        .where(RehearsalRun.repository_id.in_(repository_ids))
        .order_by(RehearsalRun.created_at.desc())
        .limit(50)
    )
    return list(result.all())


@router.get("/{run_id}", response_model=RunDetailResponse)
async def get_run(
    run_id: UUID,
    user: GitHubUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    installations = await get_accessible_installation_repositories(user, session)
    repository_ids = {repository_id for repositories in installations.values() for repository_id in repositories}
    if not repository_ids:
        raise HTTPException(status_code=404, detail="Rehearsal run was not found.")
    run = await session.scalar(
        select(RehearsalRun).where(
            RehearsalRun.id == run_id,
            RehearsalRun.repository_id.in_(repository_ids),
        )
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Rehearsal run was not found.")
    findings = await session.scalars(
        select(Finding).where(Finding.run_id == run.id).order_by(Finding.severity, Finding.created_at)
    )
    return {**RunResponse.model_validate(run).model_dump(), "findings": list(findings.all())}
