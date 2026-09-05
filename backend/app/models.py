"""SQLAlchemy 2.0 models.

Ownership is structural, not incidental: every table that holds user data
carries a ``user_id`` FK with ``ON DELETE CASCADE``, and every query in
``app/crud.py`` filters on it.
"""
from datetime import date as date_cls
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    """Naive UTC, second precision.

    Stored naive so SQLite and Postgres agree byte-for-byte, and truncated to
    seconds so the value the database holds is exactly the value the wire
    format renders (``2026-09-04T10:00:00Z``).
    """
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Always stored lower-cased; see crud.normalize_email.  The unique index
    # below is on lower(email) so a case variant cannot slip past.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Bumped on logout.  Asserted as the ``tv`` claim on both token types, so a
    # logout invalidates every outstanding access AND refresh token at once.
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    expenses: Mapped[list] = relationship(
        "Expense", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    budgets: Mapped[list] = relationship(
        "Budget", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )
    refresh_tokens: Mapped[list] = relationship(
        "RefreshToken", back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


# Case-insensitive uniqueness, enforced by the database rather than by
# convention.  Works on both Postgres and SQLite (expression indexes since 3.9).
Index("uq_users_email_lower", func.lower(User.email), unique=True)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    date: Mapped[date_cls] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="expenses")


Index("ix_expenses_user_id_date", Expense.user_id, Expense.date.desc())
Index("ix_expenses_user_id_category", Expense.user_id, Expense.category)


class Budget(Base):
    __tablename__ = "budgets"
    __table_args__ = (
        # This is what makes PUT /api/budgets a real upsert.
        UniqueConstraint("user_id", "category", "month", name="uq_budgets_user_category_month"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    month: Mapped[str] = mapped_column(String(7), nullable=False)  # 'YYYY-MM'
    limit_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )

    user: Mapped[User] = relationship("User", back_populates="budgets")


Index("ix_budgets_user_id_month", Budget.user_id, Budget.month)


class RefreshToken(Base):
    """One row per issued refresh token.

    ``token_version`` alone would make logout work but could not express
    *rotation* -- retiring one specific cookie while other devices stay signed
    in.  Storing the jti lets refresh rotate precisely, and lets a replayed
    (already-rotated) cookie be detected rather than merely rejected.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    jti: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)

    user: Mapped[User] = relationship("User", back_populates="refresh_tokens")

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > utcnow()


Index("ix_refresh_tokens_user_id", RefreshToken.user_id)
