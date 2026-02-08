from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..dependencies import get_current_user
from ..models import FilterRule, User
from ..schemas import FilterIn, FilterOut

router = APIRouter()


@router.get("/api/filters", response_model=List[FilterOut])
def list_filters(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rules = db.query(FilterRule).filter(FilterRule.user_id == user.id).all()
    return [
        FilterOut(
            id=r.id,
            name=r.name,
            enabled=r.enabled,
            priority=r.priority,
            match_json=r.match_json,
            actions_json=r.actions_json,
        )
        for r in rules
    ]


@router.post("/api/filters", response_model=FilterOut)
def create_filter(
    payload: FilterIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rule = FilterRule(
        user_id=user.id,
        name=payload.name,
        enabled=payload.enabled,
        priority=payload.priority,
        match_json=payload.match_json,
        actions_json=payload.actions_json,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return FilterOut(
        id=rule.id,
        name=rule.name,
        enabled=rule.enabled,
        priority=rule.priority,
        match_json=rule.match_json,
        actions_json=rule.actions_json,
    )

