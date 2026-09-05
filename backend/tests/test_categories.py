"""Contract 2 -- the frozen category vocabulary.

This file is deliberately literal.  Instance 2 is allowed to hardcode this list
as a build-time fallback, so the two copies must be identical down to the hex
digits; a "harmless tidy-up" here would desynchronise the palette across the
whole UI.
"""
EXPECTED = [
    {"key": "food", "label": "Food", "color": "#E8734A"},
    {"key": "transport", "label": "Transport", "color": "#4A8FE8"},
    {"key": "housing", "label": "Housing", "color": "#7C5CE0"},
    {"key": "utilities", "label": "Utilities", "color": "#2FA3A3"},
    {"key": "health", "label": "Health", "color": "#E05C7B"},
    {"key": "entertainment", "label": "Entertainment", "color": "#C77DE8"},
    {"key": "shopping", "label": "Shopping", "color": "#E8A93A"},
    {"key": "education", "label": "Education", "color": "#3F8F5B"},
    {"key": "savings", "label": "Savings", "color": "#5B7FA6"},
    {"key": "other", "label": "Other", "color": "#8A8F98"},
]


async def test_categories_match_the_frozen_contract_exactly(client):
    response = await client.get("/api/categories")
    assert response.status_code == 200
    assert response.json() == {"categories": EXPECTED}


async def test_categories_is_public(client):
    """No Authorization header at all -- this endpoint is public and static."""
    response = await client.get("/api/categories")
    assert response.status_code == 200
    assert "public" in response.headers.get("Cache-Control", "")
