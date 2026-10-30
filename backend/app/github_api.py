from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
import jwt

from app.settings import get_settings

API_URL = "https://api.github.com"
API_VERSION = "2026-03-10"


class GitHubAPIError(RuntimeError):
    pass


def _headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": API_VERSION,
        "X-GitHub-Integration-Version": "diffharbor/0.1",
    }


def create_app_jwt() -> str:
    settings = get_settings()
    if not settings.github_app_id or not settings.github_private_key_pem:
        raise GitHubAPIError("GitHub App ID and private key are required.")

    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"iat": int((now - timedelta(seconds=30)).timestamp()), "exp": int((now + timedelta(minutes=8)).timestamp()), "iss": settings.github_app_id},
        settings.github_private_key_pem,
        algorithm="RS256",
    )


async def create_installation_token(installation_id: int) -> str:
    token = create_app_jwt()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{API_URL}/app/installations/{installation_id}/access_tokens",
            headers=_headers(token),
            json={
                "permissions": {
                    "actions": "write",
                    "contents": "read",
                    "pull_requests": "read",
                }
            },
        )
    if response.status_code != 201:
        raise GitHubAPIError(f"Could not create an installation token (GitHub returned {response.status_code}).")
    return response.json()["token"]


async def user_has_repository_write_permission(
    *, installation_id: int, owner: str, repository: str, username: str
) -> bool:
    token = await create_installation_token(installation_id)
    url = (
        f"{API_URL}/repos/{quote(owner, safe='')}/{quote(repository, safe='')}"
        f"/collaborators/{quote(username, safe='')}/permission"
    )
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(url, headers=_headers(token))
    if response.status_code == 404:
        return False
    if response.status_code != 200:
        raise GitHubAPIError(
            f"Could not verify the reviewer's repository permission (GitHub returned {response.status_code})."
        )
    return response.json().get("permission") in {"write", "admin"}


async def dispatch_rehearsal_workflow(
    *,
    installation_id: int,
    owner: str,
    repository: str,
    default_branch: str,
    workflow_file: str,
    run_id: str,
    pull_request_number: int,
    base_sha: str,
    head_sha: str,
) -> dict[str, str | int | None]:
    settings = get_settings()
    token = await create_installation_token(installation_id)
    encoded_workflow = quote(workflow_file, safe="")
    url = f"{API_URL}/repos/{quote(owner, safe='')}/{quote(repository, safe='')}/actions/workflows/{encoded_workflow}/dispatches"
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            url,
            headers=_headers(token),
            json={
                "ref": default_branch,
                "inputs": {
                    "changeguard_run_id": run_id,
                    "pull_request_number": str(pull_request_number),
                    "base_sha": base_sha,
                    "head_sha": head_sha,
                    "diffharbor_url": settings.public_url or "",
                },
            },
        )
    if response.status_code not in (200, 201, 204):
        raise GitHubAPIError(f"GitHub could not dispatch the rehearsal workflow (returned {response.status_code}).")
    payload = response.json() if response.content else {}
    return {
        "workflow_run_id": payload.get("workflow_run_id"),
        "run_url": payload.get("html_url"),
    }
