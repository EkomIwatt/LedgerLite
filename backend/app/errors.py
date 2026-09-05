"""Contract 6 -- one error envelope, everywhere.

FastAPI's defaults do not match the contract: ``HTTPException`` emits
``{"detail": ...}`` and a validation failure emits a nested list of dicts.  The
handlers installed here normalize every non-2xx response to exactly
``{"error": "<sentence>"}``, and nothing else.

Two subtleties the contract requires:

* A malformed **query** parameter is a 400; a bad request **body** is a 422.
  FastAPI raises the same ``RequestValidationError`` for both, so the handler
  reads ``loc[0]`` to tell them apart.
* Validation errors render the *first* failing field as a sentence, so the
  frontend can put ``body.error`` straight on screen.
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("ledgerlite.errors")

GENERIC_500 = "Something went wrong."


class ApiError(StarletteHTTPException):
    """An HTTPException whose ``detail`` is already a finished sentence."""

    def __init__(self, status_code: int, message: str, headers: Optional[Dict[str, str]] = None):
        super().__init__(status_code=status_code, detail=message, headers=headers)


def error_response(
    status_code: int, message: str, headers: Optional[Dict[str, str]] = None
) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": message}, headers=headers)


def _field_name(loc: List[Any]) -> str:
    """Human-facing field name from a pydantic error location.

    ``("body", "amount_minor")`` -> ``amount_minor``;
    ``("query", "month")``       -> ``month``.
    """
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header", "cookie")]
    return ".".join(parts) if parts else "request"


def _ensure_sentence(text: str) -> str:
    text = (text or "").strip()
    if not text:
        return "Request validation failed."
    if not text.endswith((".", "!", "?")):
        text += "."
    return text


def validation_sentence(err: Dict[str, Any]) -> str:
    """Render one pydantic v2 error dict as a single sentence.

    Custom ``ValueError`` messages raised inside our own validators win
    outright -- that is how the contract's exact strings
    ("Password must be at least 8 characters.", "Unknown category 'foo'.")
    reach the client verbatim.
    """
    err_type = err.get("type", "")
    msg = err.get("msg", "") or ""
    ctx = err.get("ctx") or {}
    field = _field_name(list(err.get("loc") or ()))

    if err_type == "value_error":
        # pydantic v2 prefixes ValueError messages with "Value error, ".
        cleaned = msg
        for prefix in ("Value error, ", "Assertion failed, "):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix):]
        return _ensure_sentence(cleaned)

    if err_type == "missing":
        return "%s is required." % field
    if err_type in ("int_parsing", "int_type", "int_from_float"):
        return "%s must be an integer." % field
    if err_type in ("string_type", "string_pattern_mismatch"):
        return "%s must be a string." % field
    if err_type in ("bool_parsing", "bool_type"):
        return "%s must be a boolean." % field
    if err_type in ("date_parsing", "date_from_datetime_parsing", "date_type"):
        return "%s must be a valid date in YYYY-MM-DD format." % field
    if err_type == "greater_than":
        return "%s must be greater than %s." % (field, ctx.get("gt"))
    if err_type == "greater_than_equal":
        return "%s must be greater than or equal to %s." % (field, ctx.get("ge"))
    if err_type == "less_than":
        return "%s must be less than %s." % (field, ctx.get("lt"))
    if err_type == "less_than_equal":
        return "%s must be less than or equal to %s." % (field, ctx.get("le"))
    if err_type == "string_too_long":
        return "%s must be at most %s characters." % (field, ctx.get("max_length"))
    if err_type == "string_too_short":
        return "%s must be at least %s characters." % (field, ctx.get("min_length"))
    if err_type == "json_invalid":
        return "Request body must be valid JSON."

    return _ensure_sentence("%s %s" % (field, msg)) if msg else "%s is invalid." % field


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(request: Request, exc: StarletteHTTPException):
        detail = exc.detail
        if not isinstance(detail, str) or not detail.strip():
            detail = _DEFAULT_BY_STATUS.get(exc.status_code, "Request failed.")
        return error_response(exc.status_code, _ensure_sentence(detail), getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(request: Request, exc: RequestValidationError):
        errors = exc.errors()
        if not errors:
            return error_response(422, "Request validation failed.")
        first = errors[0]
        loc = list(first.get("loc") or ())
        # A bad query parameter is a client-side URL problem (400); a bad body
        # is a validation problem (422).  Contract 6 distinguishes them.
        status_code = 400 if (loc and loc[0] in ("query", "path")) else 422
        return error_response(status_code, validation_sentence(first))

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception):
        # Never leak a stack trace, a SQL string, or an exception message.
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return error_response(500, GENERIC_500)


_DEFAULT_BY_STATUS = {
    400: "Bad request.",
    401: "Not authenticated.",
    403: "Forbidden.",
    404: "Not found.",
    405: "Method not allowed.",
    409: "Conflict.",
    422: "Request validation failed.",
    500: GENERIC_500,
}
