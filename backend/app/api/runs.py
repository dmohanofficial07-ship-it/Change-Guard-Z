from uuid import UUID
import json

import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import current_user, get_accessible_installation_repositories
from app.db import get_session
from app.github_api import API_URL, _headers, create_installation_token
from app.models import Finding, GitHubUser, RehearsalRun
from app.schemas import RunDetailResponse, RunResponse
from app.settings import get_settings

router = APIRouter(prefix="/api/runs", tags=["rehearsal runs"])
MAX_REPORT_BYTES = 512 * 1024


async def _github_actions_claims(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256" or not header.get("kid"):
            raise HTTPException(status_code=401, detail="GitHub Actions identity token is invalid.")
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get("https://token.actions.githubusercontent.com/.well-known/jwks")
        response.raise_for_status()
        keys = response.json().get("keys", [])
        signing_key = next((item for item in keys if item.get("kid") == header["kid"]), None)
        if signing_key is None:
            raise HTTPException(status_code=401, detail="GitHub Actions signing key was not found.")
        key = jwt.PyJWK.from_dict(signing_key).key
        return jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience="diffharbor",
            issuer="https://token.actions.githubusercontent.com",
            leeway=10,
            options={"require": ["exp", "iat", "iss", "aud"]},
        )
    except HTTPException:
        raise
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Could not verify the GitHub Actions identity token.") from exc
    except (jwt.PyJWTError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=401, detail="GitHub Actions identity token could not be verified.") from exc


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


@router.post("/{run_id}/report", status_code=status.HTTP_202_ACCEPTED)
async def accept_workflow_report(
    run_id: UUID,
    request: Request,
    authorization: str | None = Header(default=None, alias="Authorization"),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | bool]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="GitHub Actions identity token is required.")
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_REPORT_BYTES:
        raise HTTPException(status_code=413, detail="Rehearsal report is too large.")
    raw_body = await request.body()
    if len(raw_body) > MAX_REPORT_BYTES:
        raise HTTPException(status_code=413, detail="Rehearsal report is too large.")
    try:
        report = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Rehearsal report must be valid JSON.") from exc
    if not isinstance(report, dict):
        raise HTTPException(status_code=400, detail="Rehearsal report must be a JSON object.")

    run = await session.get(RehearsalRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Rehearsal run was not found.")
    claims = await _github_actions_claims(authorization.removeprefix("Bearer "))
    repository = f"{run.repository_owner}/{run.repository_name}".lower()
    workflow_file = get_settings().github_workflow_file.strip().strip("/") or "changeguard.yml"
    expected_workflow_ref = f"{repository}/.github/workflows/{workflow_file}@refs/heads/{run.default_branch}".lower()
    if (
        str(claims.get("repository_id")) != str(run.repository_id)
        or str(claims.get("repository", "")).lower() != repository
        or claims.get("event_name") != "workflow_dispatch"
        or claims.get("ref") != f"refs/heads/{run.default_branch}"
        or str(claims.get("workflow_ref", "")).lower() != expected_workflow_ref
    ):
        raise HTTPException(status_code=403, detail="GitHub Actions run does not match this rehearsal.")
    workflow_run_id = claims.get("run_id")
    if not isinstance(workflow_run_id, int):
        raise HTTPException(status_code=403, detail="GitHub Actions run identifier is invalid.")
    installation_token = await create_installation_token(run.installation_id)
    async with httpx.AsyncClient(timeout=10) as client:
        action_response = await client.get(
            f"{API_URL}/repos/{run.repository_owner}/{run.repository_name}/actions/runs/{workflow_run_id}",
            headers=_headers(installation_token),
        )
    if action_response.status_code != 200:
        raise HTTPException(status_code=403, detail="GitHub could not confirm this workflow run.")
    action_run = action_response.json()
    expected_workflow_file = f".github/workflows/{workflow_file}"
    actual_workflow_file = str(action_run.get("path", "")).split("@", 1)[0]
    if (
        action_run.get("event") != "workflow_dispatch"
        or action_run.get("display_title") != f"DiffHarbor rehearsal {run.id}"
        or action_run.get("head_branch") != run.default_branch
        or actual_workflow_file != expected_workflow_file
    ):
        raise HTTPException(status_code=403, detail="GitHub Actions run does not match this rehearsal.")
    if (
        report.get("run_id") != str(run.id)
        or report.get("base_sha") != run.base_sha
        or report.get("head_sha") != run.head_sha
    ):
        raise HTTPException(status_code=403, detail="Rehearsal report commit evidence does not match this pull request.")

    summary = report.get("summary")
    if not isinstance(summary, dict) or summary.get("status") not in {"passed", "failed"}:
        raise HTTPException(status_code=400, detail="Rehearsal report is missing its result summary.")
    checks = report.get("checks", [])
    impact = report.get("impact", {})
    findings = report.get("findings", [])
    if not isinstance(checks, list) or not isinstance(impact, dict) or not isinstance(findings, list):
        raise HTTPException(status_code=400, detail="Rehearsal report did not match the expected structure.")
    if len(json.dumps(impact)) > 512 * 1024:
        raise HTTPException(status_code=413, detail="Impact analysis is too large.")

    run.check_results = checks[:100]
    run.impact = impact
    run.status = "completed" if summary["status"] == "passed" else "failed"
    run.failure_reason = str(summary.get("message"))[:1000] if summary.get("message") else None
    run.workflow_run_id = workflow_run_id
    run.workflow_url = f"https://github.com/{run.repository_owner}/{run.repository_name}/actions/runs/{workflow_run_id}"
    await session.execute(delete(Finding).where(Finding.run_id == run.id))
    for item in findings[:100]:
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
    return {"accepted": True, "status": run.status}
