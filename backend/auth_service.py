from __future__ import annotations

import hashlib
import secrets
import time
from typing import Optional

from fastapi import Response
from sqlalchemy.orm import Session

from .config import settings
from .models import AuthRefreshToken, User
from .schemas import AuthSessionOut, UserOut
from .security import create_access_token

REFRESH_COOKIE_NAME = "refresh_token"


def _now_ts() -> int:
    return int(time.time())


def _refresh_lifetime_seconds() -> int:
    return max(1, settings.auth_refresh_token_days) * 24 * 60 * 60


def _access_lifetime_seconds() -> int:
    return max(1, settings.auth_access_token_minutes) * 60


def hash_refresh_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def cleanup_refresh_tokens(db: Session) -> None:
    now_ts = _now_ts()
    db.query(AuthRefreshToken).filter(
        (AuthRefreshToken.expires_at <= now_ts) | (AuthRefreshToken.revoked_at > 0),
    ).delete(synchronize_session=False)


def build_auth_session(user: User) -> AuthSessionOut:
    return AuthSessionOut(
        access_token=create_access_token(user.email, expires_minutes=max(1, settings.auth_access_token_minutes)),
        token_type="bearer",
        expires_in=_access_lifetime_seconds(),
        user=UserOut(id=user.id, email=user.email),
    )


def issue_refresh_token(
    db: Session,
    user: User,
    user_agent: Optional[str],
    ip: Optional[str],
) -> str:
    cleanup_refresh_tokens(db)
    raw_token = secrets.token_urlsafe(48)
    now_ts = _now_ts()
    model = AuthRefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw_token),
        issued_at=now_ts,
        expires_at=now_ts + _refresh_lifetime_seconds(),
        revoked_at=0,
        user_agent=(user_agent or "")[:255] or None,
        ip=(ip or "")[:64] or None,
    )
    db.add(model)
    db.commit()
    return raw_token


def consume_refresh_token(db: Session, raw_token: str) -> User | None:
    token_hash = hash_refresh_token(raw_token)
    now_ts = _now_ts()
    model = (
        db.query(AuthRefreshToken)
        .filter(AuthRefreshToken.token_hash == token_hash)
        .first()
    )
    if not model:
        return None
    if model.revoked_at > 0 or model.expires_at <= now_ts:
        return None
    model.revoked_at = now_ts
    user = db.query(User).filter(User.id == model.user_id).first()
    if not user:
        return None
    db.commit()
    return user


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    token_hash = hash_refresh_token(raw_token)
    now_ts = _now_ts()
    model = (
        db.query(AuthRefreshToken)
        .filter(AuthRefreshToken.token_hash == token_hash)
        .first()
    )
    if not model:
        return
    if model.revoked_at == 0:
        model.revoked_at = now_ts
        db.commit()


def set_refresh_cookie(response: Response, raw_token: str) -> None:
    same_site = settings.auth_cookie_samesite.lower()
    if same_site not in {"lax", "strict", "none"}:
        same_site = "lax"
    cookie_domain = settings.auth_cookie_domain.strip() or None
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        max_age=_refresh_lifetime_seconds(),
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=same_site,
        path="/api/auth",
        domain=cookie_domain,
    )


def clear_refresh_cookie(response: Response) -> None:
    same_site = settings.auth_cookie_samesite.lower()
    if same_site not in {"lax", "strict", "none"}:
        same_site = "lax"
    cookie_domain = settings.auth_cookie_domain.strip() or None
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/api/auth",
        domain=cookie_domain,
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite=same_site,
    )
