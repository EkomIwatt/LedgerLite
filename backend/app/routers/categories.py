"""Contract 2 -- the frozen category vocabulary.

Public, static and cacheable: no auth, no database, and a Cache-Control header
so the frontend can fetch it once per session.
"""
from fastapi import APIRouter, Response

from app.categories import as_list
from app.schemas import CategoryListOut

router = APIRouter(prefix="/api", tags=["categories"])


@router.get("/categories", response_model=CategoryListOut)
async def list_categories(response: Response) -> CategoryListOut:
    response.headers["Cache-Control"] = "public, max-age=3600"
    return CategoryListOut(categories=as_list())
