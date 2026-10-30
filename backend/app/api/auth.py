from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import urlencode
import hmac

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import GitHubUser
from app.settings import get_settings

router = APIRouter(prefix="/api/auth", tags=["authentication"])
GITHUB_OAUTH_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"


def _fernet() -> Fernet:
    key = get_settings().auth_token_encryption_key
    if not key:
        raise HTTPException(status_code=503, detail="GitHub sign-in token encryption is not configured.")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=503, detail="GitHub sign-in encryption key is invalid.") from exc


def _encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode("utf-8")).decode("ascii")


def _decrypt_token(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=401, detail="GitHub session expired. Sign in again.") from exc


def _callback_url() -> str:
    public_url = get_settings().changeguard_public_url
    if not public_url:
        raise HTTPException(status_code=503, detail="ChangeGuard public URL is not configured.")
    return f"{public_url.rstrip('/')}/api/auth/github/callback"


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> GitHubUser:
    user_id = request.session.get("github_user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in with GitHub to continue.")
    user = await session.get(GitHubUser, int(user_id))
    if user is None:
        request.session.clear()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in with GitHub to continue.")
    return user


async def get_user_access_token(user: GitHubUser, session: AsyncSession) -> str:
    now = datetime.now(timezone.utc)
    if not user.access_token_ciphertext:
        raise HTTPException(status_code=401, detail="GitHub authorization expired. Sign in again.")

    if user.access_token_expires_at is None or user.access_token_expires_at > now + timedelta(seconds=60):
        return _decrypt_token(user.access_token_ciphertext)

    if (
        not user.refresh_token_ciphertext
        or user.refresh_token_expires_at is None
        or user.refresh_token_expires_at <= now
    ):
        user.access_token_ciphertext = None
        user.refresh_token_ciphertext = None
        await session.commit()
        raise HTTPException(status_code=401, detail="GitHub authorization expired. Sign in again.")

    settings = get_settings()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": _decrypt_token(user.refresh_token_ciphertext),
            },
        )
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="GitHub authorization expired. Sign in again.")
    token_data = response.json()
    if not token_data.get("access_token"):
        raise HTTPException(status_code=401, detail="GitHub authorization expired. Sign in again.")

    user.access_token_ciphertext = _encrypt_token(token_data["access_token"])
    user.refresh_token_ciphertext = _encrypt_token(token_data["refresh_token"]) if token_data.get("refresh_token") else None
    expires_in = token_data.get("expires_in")
    refresh_expires_in = token_data.get("refresh_token_expires_in")
    user.access_token_expires_at = now + timedelta(seconds=int(expires_in)) if expires_in else None
    user.refresh_token_expires_at = now + timedelta(seconds=int(refresh_expires_in)) if refresh_expires_in else None
    await session.commit()
    return token_data["access_token"]


async def get_accessible_installation_repositories(user: GitHubUser, session: AsyncSession) -> dict[int, set[int]]:
    token = await get_user_access_token(user, session)
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2026-03-10",
    }
    installations: dict[int, set[int]] = {}
    url = "https://api.github.com/user/installations?per_page=100"
    async with httpx.AsyncClient(timeout=20) as client:
        for _ in range(100):
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                raise HTTPException(status_code=503, detail="Could not confirm GitHub installation access.")
            payload = response.json()
            for item in payload.get("installations", []):
                if item.get("id") is None:
                    continue
                installation_id = int(item["id"])
                if installation_id in installations:
                    continue
                installations[installation_id] = set()
                repositories_url = f"https://api.github.com/user/installations/{installation_id}/repositories?per_page=100"
                for _ in range(100):
                    repositories_response = await client.get(repositories_url, headers=headers)
                    if repositories_response.status_code != 200:
                        raise HTTPException(status_code=503, detail="Could not confirm repository access for a GitHub installation.")
                    repositories_payload = repositories_response.json()
                    installations[installation_id].update(
                        int(repository["id"])
                        for repository in repositories_payload.get("repositories", [])
                        if repository.get("id") is not None
                    )
                    next_repositories_page = repositories_response.links.get("next", {}).get("url")
                    if not next_repositories_page:
                        break
                    repositories_url = next_repositories_page
                else:
                    raise HTTPException(status_code=503, detail="Too many repositories to verify for one installation.")
            next_page = response.links.get("next", {}).get("url")
            if not next_page:
                return installations
            url = next_page
    raise HTTPException(status_code=503, detail="Too many GitHub installations to verify in one request.")


@router.get("/status")
async def auth_status() -> dict[str, bool]:
    return {"configured": get_settings().github_sign_in_ready}


@router.get("/github/login")
async def github_login(request: Request) -> RedirectResponse:
    settings = get_settings()
    if not settings.github_sign_in_ready or not settings.github_client_id:
        raise HTTPException(status_code=503, detail="GitHub sign-in is not configured.")
    state = token_urlsafe(32)
    request.session["oauth_state"] = state
    query = urlencode(
        {
            "client_id": settings.github_client_id,
            "redirect_uri": _callback_url(),
            "state": state,
            "scope": "offline_access",
        }
    )
    return RedirectResponse(f"{GITHUB_OAUTH_URL}?{query}", status_code=302)


@router.get("/github/callback")
async def github_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    settings = get_settings()
    expected_state = request.session.pop("oauth_state", None)
    if error:
        raise HTTPException(status_code=401, detail="GitHub sign-in was not completed.")
    if not code or not state or not expected_state or not hmac.compare_digest(state, expected_state):
        raise HTTPException(status_code=400, detail="GitHub sign-in state did not match.")
    if not settings.github_sign_in_ready or not settings.github_client_id or not settings.github_client_secret:
        raise HTTPException(status_code=503, detail="GitHub sign-in is not configured.")

    async with httpx.AsyncClient(timeout=20) as client:
        token_response = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
                "redirect_uri": _callback_url(),
            },
        )
        if token_response.status_code != 200:
            raise HTTPException(status_code=401, detail="GitHub could not complete sign-in.")
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=401, detail="GitHub did not return an access token.")
        user_response = await client.get(
            GITHUB_USER_URL,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "X-GitHub-Api-Version": "2026-03-10",
            },
        )
    if user_response.status_code != 200:
        raise HTTPException(status_code=401, detail="GitHub could not identify this account.")

    github_profile = user_response.json()
    user_id = int(github_profile["id"])
    user = await session.get(GitHubUser, user_id)
    if user is None:
        user = GitHubUser(github_user_id=user_id, login=str(github_profile["login"]))
        session.add(user)
    user.login = str(github_profile["login"])
    user.display_name = github_profile.get("name")
    user.avatar_url = github_profile.get("avatar_url")
    user.access_token_ciphertext = _encrypt_token(access_token)
    user.refresh_token_ciphertext = _encrypt_token(token_data["refresh_token"]) if token_data.get("refresh_token") else None
    now = datetime.now(timezone.utc)
    expires_in = token_data.get("expires_in")
    refresh_expires_in = token_data.get("refresh_token_expires_in")
    user.access_token_expires_at = now + timedelta(seconds=int(expires_in)) if expires_in else None
    user.refresh_token_expires_at = now + timedelta(seconds=int(refresh_expires_in)) if refresh_expires_in else None
    await session.commit()

    request.session.clear()
    request.session["github_user_id"] = user_id
    return RedirectResponse(settings.frontend_origin, status_code=302)


@router.get("/me")
async def get_me(user: GitHubUser = Depends(current_user)) -> dict[str, str | int | None]:
    return {
        "id": user.github_user_id,
        "login": user.login,
        "name": user.display_name,
        "avatar_url": user.avatar_url,
    }


@router.post("/logout")
async def logout(
    request: Request,
    user: GitHubUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    token = None
    if user.access_token_ciphertext:
        try:
            token = await get_user_access_token(user, session)
        except (HTTPException, httpx.HTTPError):
            token = None
    revoked = False
    settings = get_settings()
    if token and settings.github_client_id and settings.github_client_secret:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.request(
                    "DELETE",
                    f"https://api.github.com/applications/{settings.github_client_id}/grant",
                    auth=(settings.github_client_id, settings.github_client_secret),
                    headers={
                        "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2026-03-10",
                    },
                    json={"access_token": token},
                )
            revoked = response.status_code == 204
        except httpx.HTTPError:
            revoked = False

    user.access_token_ciphertext = None
    user.refresh_token_ciphertext = None
    user.access_token_expires_at = None
    user.refresh_token_expires_at = None
    await session.commit()
    request.session.clear()
    return {"signed_out": True, "github_authorization_revoked": revoked}
