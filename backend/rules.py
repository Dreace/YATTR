from __future__ import annotations

import json
from typing import Any

from .models import Entry, FilterRule, UserEntryState


def _match(rule: FilterRule, entry: Entry) -> bool:
    try:
        matcher = json.loads(rule.match_json)
    except json.JSONDecodeError:
        return False

    text = " ".join(
        [
            entry.title or "",
            entry.summary or "",
            entry.content_text or "",
            entry.author or "",
        ]
    ).lower()

    keywords = [k.lower() for k in matcher.get("keywords", [])]
    if keywords and not any(k in text for k in keywords):
        return False

    return True


def _apply_actions(db, user_id: int, entry: Entry, actions: dict[str, Any]) -> None:
    state = (
        db.query(UserEntryState)
        .filter(UserEntryState.user_id == user_id, UserEntryState.entry_id == entry.id)
        .first()
    )
    if not state:
        return

    if actions.get("mark_read") is True:
        state.is_read = True
    if actions.get("star") is True:
        state.is_starred = True
    if actions.get("later") is True:
        state.is_later = True


def apply_filters(db, user_id: int, entry: Entry) -> None:
    rules = (
        db.query(FilterRule)
        .filter(FilterRule.user_id == user_id, FilterRule.enabled.is_(True))
        .order_by(FilterRule.priority.asc())
        .all()
    )
    for rule in rules:
        if _match(rule, entry):
            try:
                actions = json.loads(rule.actions_json)
            except json.JSONDecodeError:
                continue
            _apply_actions(db, user_id, entry, actions)
