import hashlib
import hmac
import json
from uuid import UUID, uuid4

from arq.connections import ArqRedis
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.github_api import user_has_repository_write_permission
from app.models import GitHubInstallation, RehearsalRun, WebhookDelivery
from app.settings import get_settings

router = APIRouter(prefix="/api/github", tags=["github"])
PULL_REQUEST_ACTIONS = {"opened", "reopened", "synchronize", "ready_for_review"}
MAX_WEBHOOK_BYTES = 2 * 1024 * 1024


def verify_signature(payload: bytes, secret: str, signature: str | None) -> bool:
    if not signature or not signature.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={digest}", signature)


def _installation_from_payload(payload: dict) -> GitHubInstallation | None:
    installation = payload.get("installation")
    account = installation.get("account") if isinstance(installation, dict) else None
    if not isinstance(installation, dict) or not isinstance(account, dict) or not installation.get("id"):
        return None
    return GitHubInstallation(
        installation_id=int(installation["id"]),
        account_login=str(account.get("login", "unknown")),
        account_type=str(account.get("type", "User")),
        repository_selection=str(installation.get("repository_selection", "selected")),
        active=True,
    )


async def _upsert_installation(session: AsyncSession, payload: dict, *, active: bool = True) -> int | None:
    row = _installation_from_payload(payload)
    if row is None:
        installation = payload.get("installation")
        if not isinstance(installation, dict) or not installation.get("id"):
            return None
        installation_id = int(installation["id"])
        existing = await session.get(GitHubInstallation, installation_id)
        if existing is None:
            return None
        existing.active = active
        return installation_id
    row.active = active
    statement = insert(GitHubInstallation).values(
        installation_id=row.installation_id,
        account_login=row.account_login,
        account_type=row.account_type,
        repository_selection=row.repository_selection,
        active=row.active,
    ).on_conflict_do_update(
        index_elements=[GitHubInstallation.installation_id],
        set_={
            "account_login": row.account_login,
            "account_type": row.account_type,
            "repository_selection": row.repository_selection,
            "active": row.active,
        },
    )
    await session.execute(statement)
    return row.installation_id


async def _create_rehearsal(
    session: AsyncSession,
    payload: dict,
    installation_id: int,
    *,
    initial_status: str = "queued",
) -> UUID | None:
    repository = payload.get("repository")
    pull_request = payload.get("pull_request")
    if not isinstance(repository, dict) or not isinstance(pull_request, dict):
        return None
    owner = repository.get("owner") or {}
    base = pull_request.get("base") or {}
    head = pull_request.get("head") or {}
    repo_id = repository.get("id")
    number = payload.get("number")
    base_sha = base.get("sha")
    head_sha = head.get("sha")
    if not all((repo_id, number, base_sha, head_sha, owner.get("login"), repository.get("name"))):
        return None

    candidate_id = uuid4()
    values = {
        "id": candidate_id,
        "installation_id": installation_id,
        "repository_id": int(repo_id),
        "repository_owner": str(owner["login"]),
        "repository_name": str(repository["name"]),
        "default_branch": str(repository.get("default_branch") or base.get("ref") or "main"),
        "pull_request_number": int(number),
        "pull_request_title": str(pull_request.get("title") or "Untitled pull request")[:5000],
        "base_ref": str(base.get("ref") or ""),
        "head_ref": str(head.get("ref") or ""),
        "base_sha": str(base_sha),
        "head_sha": str(head_sha),
        "status": initial_status,
    }
    statement = insert(RehearsalRun).values(**values).on_conflict_do_nothing(
        index_elements=[RehearsalRun.repository_id, RehearsalRun.pull_request_number, RehearsalRun.head_sha]
    ).returning(RehearsalRun.id)
    inserted_id = (await session.execute(statement)).scalar_one_or_none()
    if inserted_id is not None:
        return inserted_id
    existing = await session.scalar(
        select(RehearsalRun.id).where(
            RehearsalRun.repository_id == int(repo_id),
            RehearsalRun.pull_request_number == int(number),
            RehearsalRun.head_sha == str(head_sha),
        )
    )
    return existing


async def _approve_fork_rehearsal(session: AsyncSession, payload: dict) -> UUID | None:
    review = payload.get("review")
    repository = payload.get("repository")
    pull_request = payload.get("pull_request")
    installation = payload.get("installation")
    if not all(isinstance(item, dict) for item in (review, repository, pull_request, installation)):
        return None
    head = pull_request.get("head") or {}
    head_repository = head.get("repo") or {}
    reviewer = review.get("user") or {}
    current_sha = str(head.get("sha") or "")
    reviewed_sha = str(review.get("commit_id") or "")
    owner = (repository.get("owner") or {}).get("login")
    repo_name = repository.get("name")
    reviewer_login = reviewer.get("login")
    installation_id = installation.get("id")
    pull_request_number = payload.get("number")
    repository_id = repository.get("id")
    if (
        review.get("state") != "approved"
        or not current_sha
        or reviewed_sha != current_sha
        or not owner
        or not repo_name
        or not reviewer_login
        or not installation_id
        or not pull_request_number
        or not repository_id
        or head_repository.get("id") == repository_id
    ):
        return None

    has_write_access = await user_has_repository_write_permission(
        installation_id=int(installation_id),
        owner=str(owner),
        repository=str(repo_name),
        username=str(reviewer_login),
    )
    if not has_write_access:
        return None

    run = await session.scalar(
        select(RehearsalRun).where(
            RehearsalRun.repository_id == int(repository_id),
            RehearsalRun.pull_request_number == int(pull_request_number),
            RehearsalRun.head_sha == current_sha,
            RehearsalRun.status == "approval_required",
        )
    )
    if run is None:
        return None
    run.status = "queued"
    run.failure_reason = None
    return run.id


async def _handle_workflow_run(session: AsyncSession, payload: dict) -> UUID | None:
    workflow_run = payload.get("workflow_run")
    if not isinstance(workflow_run, dict):
        return None
    display_title = str(workflow_run.get("display_title") or "")
    prefixes = ("DiffHarbor rehearsal ", "ChangeGuard rehearsal ")
    prefix = next((value for value in prefixes if display_title.startswith(value)), None)
    if prefix is None:
        return None
    try:
        run_id = UUID(display_title.removeprefix(prefix).strip())
    except ValueError:
        return None

    run = await session.get(RehearsalRun, run_id)
    if run is None:
        return None
    run.workflow_run_id = int(workflow_run["id"]) if workflow_run.get("id") else None
    run.workflow_url = workflow_run.get("html_url")
    action = payload.get("action")
    if action == "in_progress":
        run.status = "running"
    elif action == "completed":
        run.status = "completed" if workflow_run.get("conclusion") == "success" else "failed"
        if run.status == "failed":
            run.failure_reason = f"GitHub Actions concluded: {workflow_run.get('conclusion') or 'unknown'}"
    return run.id


@router.get("/status")
async def github_status() -> dict[str, str | bool | None]:
    settings = get_settings()
    return {
        "configured": settings.github_app_ready,
        "installation_url": settings.github_install_url,
        "provider": "github",
        "repository_policy": "public_only",
    }


@router.post("/webhook", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
    signature: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    event_name: str | None = Header(default=None, alias="X-GitHub-Event"),
    delivery_id: str | None = Header(default=None, alias="X-GitHub-Delivery"),
) -> dict[str, str | bool | None]:
    settings = get_settings()
    if not settings.github_webhook_secret:
        raise HTTPException(status_code=503, detail="GitHub webhook secret is not configured.")
    if not event_name or not delivery_id:
        raise HTTPException(status_code=400, detail="GitHub event and delivery headers are required.")

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="Webhook payload is too large.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_WEBHOOK_BYTES:
            raise HTTPException(status_code=413, detail="Webhook payload is too large.")
    raw_body = bytes(body)
    if not verify_signature(raw_body, settings.github_webhook_secret, signature):
        raise HTTPException(status_code=401, detail="Webhook signature did not match.")
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Webhook payload must be valid JSON.") from exc

    action = payload.get("action")
    existing_delivery = await session.get(WebhookDelivery, delivery_id)
    if existing_delivery:
        queue: ArqRedis = request.app.state.arq_pool
        if event_name in {"pull_request", "pull_request_review"} and existing_delivery.run_id:
            run = await session.get(RehearsalRun, existing_delivery.run_id)
            if run and run.status == "queued" and run.workflow_run_id is None:
                await queue.enqueue_job("dispatch_rehearsal", str(run.id), _job_id=f"dispatch:{run.id}")
        return {"accepted": True, "duplicate": True, "run_id": str(existing_delivery.run_id) if existing_delivery.run_id else None}

    if event_name == "pull_request" and (payload.get("repository") or {}).get("private") is not False:
        session.add(WebhookDelivery(delivery_id=delivery_id, event_name=event_name, event_action=action))
        await session.commit()
        return {"accepted": True, "duplicate": False, "run_id": None, "reason": "public_repositories_only"}

    run_id: UUID | None = None
    installation_id: int | None = None
    should_dispatch = False
    if event_name == "installation":
        active = action not in {"deleted", "suspend"}
        installation_id = await _upsert_installation(session, payload, active=active)
    elif event_name == "pull_request" and action in PULL_REQUEST_ACTIONS:
        pull_request = payload.get("pull_request") or {}
        if not pull_request.get("draft"):
            installation_id = await _upsert_installation(session, payload)
            if installation_id is None:
                raise HTTPException(status_code=400, detail="Pull request event did not include an installation.")
            repository = payload.get("repository") or {}
            head_repository = (pull_request.get("head") or {}).get("repo") or {}
            same_repository = head_repository.get("id") == repository.get("id")
            run_id = await _create_rehearsal(
                session,
                payload,
                installation_id,
                initial_status="queued" if same_repository else "approval_required",
            )
            should_dispatch = same_repository and run_id is not None
    elif event_name == "pull_request_review" and action == "submitted":
        review = payload.get("review") or {}
        if review.get("state") == "approved":
            run_id = await _approve_fork_rehearsal(session, payload)
            should_dispatch = run_id is not None
    elif event_name == "workflow_run":
        run_id = await _handle_workflow_run(session, payload)

    session.add(WebhookDelivery(delivery_id=delivery_id, event_name=event_name, event_action=action, run_id=run_id))
    await session.commit()

    if should_dispatch and run_id:
        queue: ArqRedis = request.app.state.arq_pool
        await queue.enqueue_job("dispatch_rehearsal", str(run_id), _job_id=f"dispatch:{run_id}")
    return {"accepted": True, "duplicate": False, "run_id": str(run_id) if run_id else None}
