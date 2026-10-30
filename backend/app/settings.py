from functools import lru_cache
import os

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://changeguard:changeguard@localhost:5432/changeguard"
    redis_url: str = "redis://localhost:6379/0"
    github_app_id: str | None = None
    github_app_slug: str | None = None
    github_app_private_key: str | None = None
    github_webhook_secret: str | None = None
    changeguard_public_url: str | None = None
    github_client_id: str | None = None
    github_client_secret: str | None = None
    session_secret: str | None = None
    auth_token_encryption_key: str | None = None
    cookie_secure: bool = False
    github_workflow_file: str = "changeguard.yml"
    frontend_origin: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def github_app_ready(self) -> bool:
        required_values = (
            self.github_app_id,
            self.github_app_slug,
            self.github_app_private_key,
            self.github_webhook_secret,
            self.public_url,
        )
        return all(value and value.strip() for value in required_values)

    @property
    def github_sign_in_ready(self) -> bool:
        required_values = (
            self.github_client_id,
            self.github_client_secret,
            self.session_secret,
            self.auth_token_encryption_key,
            self.public_url,
        )
        return all(value and value.strip() for value in required_values)

    @property
    def github_install_url(self) -> str | None:
        if not self.github_app_slug:
            return None
        slug = self.github_app_slug.strip().strip("/")
        return f"https://github.com/apps/{slug}/installations/new"

    @property
    def github_private_key_pem(self) -> str | None:
        if not self.github_app_private_key:
            return None
        return self.github_app_private_key.replace("\\n", "\n")

    @property
    def public_url(self) -> str | None:
        configured = self.changeguard_public_url
        if configured and configured.strip():
            return configured.strip().rstrip("/")
        render_hostname = os.getenv("RENDER_EXTERNAL_HOSTNAME")
        return f"https://{render_hostname}" if render_hostname else None

    @property
    def web_origin(self) -> str:
        configured = self.frontend_origin
        if configured and configured.strip():
            return configured.strip().rstrip("/")
        return self.public_url or "http://localhost:5173"

    @property
    def database_async_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            return "postgresql+asyncpg://" + url.removeprefix("postgres://")
        if url.startswith("postgresql://"):
            return "postgresql+asyncpg://" + url.removeprefix("postgresql://")
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
