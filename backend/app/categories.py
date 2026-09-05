"""Contract 2 -- the frozen category vocabulary.

This list is the single source of truth for category keys, display labels and
the chart palette.  It is FROZEN: order, keys, labels and colors are all part of
the contract, and Instance 2 may hardcode an identical copy as a build-time
fallback.
"""
from typing import Dict, List, Optional, Tuple

# (key, label, color) -- order is contract-significant.
CATEGORIES: Tuple[Dict[str, str], ...] = (
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
)

CATEGORY_KEYS: Tuple[str, ...] = tuple(c["key"] for c in CATEGORIES)

# key -> position in the frozen list.  Used as the tie-break ordering in
# Contract 4 (budget listing) and Contract 5b (category breakdown).
CATEGORY_ORDER: Dict[str, int] = {c["key"]: i for i, c in enumerate(CATEGORIES)}

_BY_KEY: Dict[str, Dict[str, str]] = {c["key"]: c for c in CATEGORIES}


def is_valid_category(key: str) -> bool:
    return key in _BY_KEY


def get_category(key: str) -> Optional[Dict[str, str]]:
    return _BY_KEY.get(key)


def label_for(key: str) -> str:
    entry = _BY_KEY.get(key)
    return entry["label"] if entry else key


def color_for(key: str) -> str:
    entry = _BY_KEY.get(key)
    return entry["color"] if entry else "#8A8F98"


def order_index(key: str) -> int:
    """Sort key for the frozen category order; unknown keys sort last."""
    return CATEGORY_ORDER.get(key, len(CATEGORIES))


def as_list() -> List[Dict[str, str]]:
    return [dict(c) for c in CATEGORIES]
