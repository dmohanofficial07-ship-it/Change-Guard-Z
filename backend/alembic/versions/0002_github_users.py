"""Add GitHub users for authenticated dashboard sessions."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_github_users"
down_revision: Union[str, None] = "0001_core_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rehearsal_runs", sa.Column("check_results", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("rehearsal_runs", sa.Column("impact", sa.JSON(), nullable=False, server_default="{}"))
    op.create_table(
        "github_users",
        sa.Column("github_user_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("login", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("access_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("refresh_token_ciphertext", sa.Text(), nullable=True),
        sa.Column("access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("github_user_id"),
    )


def downgrade() -> None:
    op.drop_table("github_users")
    op.drop_column("rehearsal_runs", "impact")
    op.drop_column("rehearsal_runs", "check_results")
