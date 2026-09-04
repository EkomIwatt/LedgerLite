"""Postgres-shaped checks that the SQLite test database cannot make.

The suite runs on in-memory SQLite but the deploy target is Postgres (Neon).
Everything below compiles the real models and the real month-bucketing
expression against the Postgres dialect, so a Postgres-only mistake -- a type
that does not exist, a functional index that will not compile, the wrong
``to_char`` format -- fails here rather than on a redeploy.

This is compile-level, not execution-level. Running the suite against a live
Postgres remains a merge-time check.
"""
import pytest
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.schema import CreateIndex, CreateTable

from app.analytics import month_bucket_expr
from app.models import Base

PG = postgresql.dialect()


def ddl_for(table) -> str:
    return str(CreateTable(table).compile(dialect=PG))


@pytest.mark.parametrize(
    "table_name", ["users", "expenses", "budgets", "refresh_tokens"]
)
def test_every_table_compiles_to_postgres_ddl(table_name):
    ddl = ddl_for(Base.metadata.tables[table_name])
    assert "CREATE TABLE %s" % table_name in ddl


def test_money_columns_are_bigint_not_integer():
    """Kobo amounts overflow a 32-bit INTEGER well inside the allowed range."""
    assert "amount_minor BIGINT" in ddl_for(Base.metadata.tables["expenses"])
    assert "limit_minor BIGINT" in ddl_for(Base.metadata.tables["budgets"])


def test_expense_date_is_a_date_not_a_timestamp():
    assert "date DATE NOT NULL" in ddl_for(Base.metadata.tables["expenses"])


@pytest.mark.parametrize("table_name", ["expenses", "budgets", "refresh_tokens"])
def test_user_fk_cascades_on_delete(table_name):
    ddl = ddl_for(Base.metadata.tables[table_name])
    assert "FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE" in ddl


def test_budget_uniqueness_is_user_category_month():
    ddl = ddl_for(Base.metadata.tables["budgets"])
    assert "UNIQUE (user_id, category, month)" in ddl


def test_email_uniqueness_is_a_functional_lower_index():
    indexes = {i.name: i for i in Base.metadata.tables["users"].indexes}
    sql = str(CreateIndex(indexes["uq_users_email_lower"]).compile(dialect=PG))
    assert "CREATE UNIQUE INDEX" in sql
    assert "ON users (lower(email))" in sql
    # The same index must also compile for the SQLite test database.
    assert "ON users (lower(email))" in str(
        CreateIndex(indexes["uq_users_email_lower"]).compile(dialect=sqlite.dialect())
    )


def test_expense_indexes_cover_the_scoped_access_patterns():
    indexes = {i.name: i for i in Base.metadata.tables["expenses"].indexes}
    by_date = str(CreateIndex(indexes["ix_expenses_user_id_date"]).compile(dialect=PG))
    assert "(user_id, date DESC)" in by_date
    by_category = str(
        CreateIndex(indexes["ix_expenses_user_id_category"]).compile(dialect=PG)
    )
    assert "(user_id, category)" in by_category


# --------------------------------------------------------------------------
# month bucketing
# --------------------------------------------------------------------------
def test_postgres_month_bucket_uses_to_char():
    sql = str(
        month_bucket_expr("postgresql").compile(
            dialect=PG, compile_kwargs={"literal_binds": True}
        )
    )
    assert sql == "to_char(expenses.date, 'YYYY-MM')"


def test_sqlite_month_bucket_uses_strftime():
    sql = str(
        month_bucket_expr("sqlite").compile(
            dialect=sqlite.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert sql == "strftime('%Y-%m', expenses.date)"


def test_unknown_dialect_falls_back_to_a_portable_substring():
    sql = str(
        month_bucket_expr("").compile(
            dialect=PG, compile_kwargs={"literal_binds": True}
        )
    )
    assert "substr" in sql.lower()
    assert "CAST(expenses.date AS VARCHAR)" in sql
