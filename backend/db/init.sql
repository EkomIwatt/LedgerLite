-- LedgerLite schema (PostgreSQL).
--
-- Run automatically by docker-compose on first boot of an empty data volume.
-- The application also calls Base.metadata.create_all() at startup, which is
-- idempotent, so a hosted database (Neon/Render) that never sees this file
-- still comes up correctly. Everything here is IF NOT EXISTS so the two paths
-- can coexist.

-- --------------------------------------------------------------------------
-- users
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          VARCHAR(320) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    -- Bumped on logout; asserted as the `tv` claim on every token, so a logout
    -- retires outstanding access AND refresh tokens at once.
    token_version  INTEGER      NOT NULL DEFAULT 0,
    created_at     TIMESTAMP    NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- Case-insensitive uniqueness enforced by the database, not by convention.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));

-- --------------------------------------------------------------------------
-- expenses
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Money is always an integer of the minor unit (kobo). Never a float.
    amount_minor  BIGINT      NOT NULL,
    category      VARCHAR(32) NOT NULL,
    date          DATE        NOT NULL,
    note          VARCHAR(500),
    created_at    TIMESTAMP   NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at    TIMESTAMP   NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

-- Serves the default listing (date DESC, id DESC) and every month-range
-- analytics scan.
CREATE INDEX IF NOT EXISTS ix_expenses_user_id_date
    ON expenses (user_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_expenses_user_id_category
    ON expenses (user_id, category);

-- --------------------------------------------------------------------------
-- budgets
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category     VARCHAR(32) NOT NULL,
    month        VARCHAR(7)  NOT NULL,   -- 'YYYY-MM'
    limit_minor  BIGINT      NOT NULL,
    created_at   TIMESTAMP   NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at   TIMESTAMP   NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    -- This is what makes PUT /api/budgets a real upsert.
    CONSTRAINT uq_budgets_user_category_month UNIQUE (user_id, category, month)
);

CREATE INDEX IF NOT EXISTS ix_budgets_user_id_month
    ON budgets (user_id, month);

-- --------------------------------------------------------------------------
-- refresh_tokens
-- --------------------------------------------------------------------------
-- One row per issued refresh token. token_version alone would make logout
-- work but could not express rotation -- retiring one specific cookie while
-- other devices stay signed in -- nor detect a replayed cookie.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    jti         VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMP   NOT NULL,
    revoked_at  TIMESTAMP,
    created_at  TIMESTAMP   NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_jti     ON refresh_tokens (jti);
