from contextlib import asynccontextmanager
from pathlib import Path

from arq import create_pool
from arq.connections import RedisSettings
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from secrets import token_urlsafe
from starlette.middleware.sessions import SessionMiddleware

from app.api.auth import router as auth_router
from app.api.github import router as github_router
from app.api.runs import router as runs_router
from app.db import engine
from app.queue import deserialize_job, serialize_job
from app.settings import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.arq_pool = await create_pool(
        RedisSettings.from_dsn(settings.redis_url),
        job_serializer=serialize_job,
        job_deserializer=deserialize_job,
    )
    try:
        yield
    finally:
        await application.state.arq_pool.aclose()
        await engine.dispose()


app = FastAPI(
    title="DiffHarbor API",
    description="API for change-impact analysis and safe pull-request rehearsals.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.session_secret or token_urlsafe(48),
    session_cookie="changeguard_session",
    same_site="lax",
    https_only=settings.cookie_secure,
    max_age=8 * 60 * 60,
)
app.include_router(github_router)
app.include_router(auth_router)
app.include_router(runs_router)


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "diffharbor-api"}

frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
frontend_index = frontend_dist / "index.html"
if frontend_index.is_file():
    frontend_assets = frontend_dist / "assets"
    if frontend_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=frontend_assets), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    async def frontend_home() -> FileResponse:
        return FileResponse(frontend_index)

    @app.get("/{frontend_path:path}", include_in_schema=False)
    async def frontend_routes(frontend_path: str) -> FileResponse:
        if frontend_path.startswith("api/") or frontend_path in {"docs", "redoc", "openapi.json"}:
            raise HTTPException(status_code=404)
        candidate = (frontend_dist / frontend_path).resolve()
        try:
            candidate.relative_to(frontend_dist.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=404) from exc
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(frontend_index)
