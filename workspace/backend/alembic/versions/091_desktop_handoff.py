"""Single-use desktop sign-in codes.

Revision ID: 091
Revises: 090
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("desktop_handoffs",
        sa.Column("code_hash", sa.Text(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_challenge", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("session_expires_at", sa.BigInteger(), nullable=False),
        sa.Column("auth_time", sa.BigInteger(), nullable=False),
        sa.Column("session_key_id", sa.Text(), nullable=False),
    )
    op.create_index("ix_desktop_handoffs_expires_at", "desktop_handoffs", ["expires_at"])


def downgrade():
    op.drop_table("desktop_handoffs")
