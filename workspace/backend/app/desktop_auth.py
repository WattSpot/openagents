"""Short-lived, PKCE-bound browser-to-desktop handoff. Credentials stay off loopback."""

import base64
import hashlib
import secrets
import time
from datetime import datetime, timezone

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import config
from app.database import get_db
from app.firebase_auth import mint_workspace_session, verify_workspace_session
from app.models import DesktopHandoff, User
from app.oidc_auth import OIDC_SESSION_COOKIE, oidc_enabled
from app.response import success_response

router = APIRouter(prefix="/v1/auth/desktop", tags=["Auth"])


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _response(data: dict, status: int = 200):
    response = JSONResponse(success_response(data) if status == 200 else {"code": status, "message": "Desktop sign-in rejected"}, status_code=status)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class HandoffRequest(BaseModel):
    code_challenge: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    code_challenge_method: str = Field(default="S256", pattern=r"^S256$")


class ExchangeRequest(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    code_verifier: str = Field(pattern=r"^[A-Za-z0-9._~-]{43,128}$")


@router.post("/handoff")
def handoff(body: HandoffRequest, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(OIDC_SESSION_COOKIE, "")
    claims = verify_workspace_session(token) if oidc_enabled() else None
    if not claims or claims.get("identity_provider") != "oidc" or claims.get("issuer") != config.OIDC_ISSUER:
        return _response({}, 401)
    user = db.execute(select(User).where(User.oidc_issuer == claims["issuer"], User.oidc_subject == claims["subject"])).scalar_one_or_none()
    if user is None:
        return _response({}, 401)
    decoded = jwt.decode(token, config.WORKSPACE_SESSION_SECRET, algorithms=["HS256"], issuer="openagents-workspace")
    now = int(time.time())
    code = secrets.token_urlsafe(32)
    db.execute(delete(DesktopHandoff).where(DesktopHandoff.expires_at <= now))
    db.add(DesktopHandoff(
        code_hash=_hash(code), user_id=user.id, code_challenge=body.code_challenge,
        expires_at=min(now + 60, decoded["exp"]), session_expires_at=decoded["exp"],
        auth_time=decoded.get("auth_time", decoded["iat"]),
        session_key_id=_hash(config.WORKSPACE_SESSION_SECRET),
    ))
    db.commit()
    return _response({"code": code, "expires_in": 60})


@router.post("/exchange")
def exchange(body: ExchangeRequest, db: Session = Depends(get_db)):
    if not oidc_enabled():
        return _response({}, 401)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(body.code_verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    # DELETE ... RETURNING is the claim: concurrent exchanges cannot both win.
    row = db.execute(delete(DesktopHandoff).where(
        DesktopHandoff.code_hash == _hash(body.code), DesktopHandoff.code_challenge == challenge,
        DesktopHandoff.expires_at > int(time.time()),
        DesktopHandoff.session_key_id == _hash(config.WORKSPACE_SESSION_SECRET),
    ).returning(DesktopHandoff)).scalar_one_or_none()
    if row is None:
        db.rollback()
        return _response({}, 401)
    user = db.get(User, row.user_id)
    if not user or user.oidc_issuer != config.OIDC_ISSUER or not user.oidc_subject:
        db.commit()
        return _response({}, 401)
    token, expiry = mint_workspace_session({
        "identity_provider": "oidc", "issuer": user.oidc_issuer, "subject": user.oidc_subject,
        "email": user.email, "display_name": user.display_name, "email_verified": user.email_verified_at is not None,
    }, auth_time=row.auth_time, expires_at=row.session_expires_at)
    db.commit()
    return _response({"session_token": token, "expires_at": datetime.fromtimestamp(expiry, tz=timezone.utc).isoformat(), "email": user.email, "display_name": user.display_name})
