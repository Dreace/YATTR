from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from .auth_service import (
    REFRESH_COOKIE_NAME,
    build_auth_session,
    clear_refresh_cookie,
    consume_refresh_token,
    issue_refresh_token,
    revoke_refresh_token,
    set_refresh_cookie,
)
from .db import get_db
from .models import User
from .schemas import AuthSessionOut
from .security import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _client_ip(request: Request) -> str | None:
    if not request.client:
        return None
    return request.client.host


@router.post("/login", response_model=AuthSessionOut)
def login(
    response: Response,
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    session = build_auth_session(user)
    refresh_token = issue_refresh_token(
        db,
        user,
        request.headers.get("user-agent"),
        _client_ip(request),
    )
    set_refresh_cookie(response, refresh_token)
    return session


@router.post("/refresh", response_model=AuthSessionOut)
def refresh(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME, "")
    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    user = consume_refresh_token(db, raw_token)
    if not user:
        clear_refresh_cookie(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    session = build_auth_session(user)
    new_refresh_token = issue_refresh_token(
        db,
        user,
        request.headers.get("user-agent"),
        _client_ip(request),
    )
    set_refresh_cookie(response, new_refresh_token)
    return session


@router.post("/logout")
def logout(
    response: Response,
    request: Request,
    db: Session = Depends(get_db),
):
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME, "")
    if raw_token:
        revoke_refresh_token(db, raw_token)
    clear_refresh_cookie(response)
    return {"ok": True}
