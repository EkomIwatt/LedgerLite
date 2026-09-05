# Python is pinned exactly.
#
# Snipp's lesson: Render otherwise defaults to a Python version with no
# prebuilt pydantic-core wheel, and the source build then fails on a read-only
# filesystem. Keep this in step with .python-version.
FROM python:3.12.8-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# argon2-cffi ships manylinux wheels, but build-essential keeps the image
# buildable if a transitive dependency ever needs to compile.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Never run as root.
RUN useradd --create-home --shell /bin/false ledgerlite \
    && chown -R ledgerlite:ledgerlite /app
USER ledgerlite

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# Render supplies $PORT; default to 8000 for local docker-compose.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
