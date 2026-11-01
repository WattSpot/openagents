"""The loopback carries a code; only its PKCE verifier can obtain a session."""

import base64
import hashlib
import time

import jwt
import pytest
from sqlalchemy import select

from app.access import get_or_create_user
from app.config import config
from app.firebase_auth import mint_workspace_session
from app.models import DesktopHandoff
from app.oidc_auth import principal_from_claims
from tests.test_oidc_auth import ISSUER, oidc_settings  # noqa: F401

VERIFIER = "v" * 43
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).rstrip(b"=").decode()


@pytest.fixture
def browser(client, db, oidc_settings):
    principal = principal_from_claims({"sub": "desktop-user", "email": "desktop@example.test", "email_verified": True}, ISSUER)
    get_or_create_user(db, principal)
    db.commit()
    token, expires = mint_workspace_session(principal, expires_at=int(time.time()) + 7200)
    client.cookies.set("oa_oidc_session", token)
    return client, expires


def issue(browser):
    client, _ = browser
    response = client.post("/v1/auth/desktop/handoff", json={"code_challenge": CHALLENGE}, headers={"Origin": config.FRONTEND_BASE_URL})
    assert response.status_code == 200
    return response.json()["data"]["code"]


def redeem(client, code, verifier=VERIFIER):
    return client.post("/v1/auth/desktop/exchange", json={"code": code, "code_verifier": verifier})


def test_handoff_hash_only_and_single_use(browser, db):
    client, expires = browser
    code = issue(browser)
    row = db.execute(select(DesktopHandoff)).scalar_one()
    assert row.code_hash == hashlib.sha256(code.encode()).hexdigest()
    assert code not in repr(row.__dict__)
    assert 0 < row.expires_at - time.time() <= 60
    client.cookies.clear()
    response = redeem(client, code)
    assert response.status_code == 200
    token = response.json()["data"]["session_token"]
    claims = jwt.decode(token, config.WORKSPACE_SESSION_SECRET, algorithms=["HS256"], issuer="openagents-workspace")
    assert claims["exp"] == expires
    assert claims["subject"] == "desktop-user" and claims["issuer"] == ISSUER
    assert response.headers["cache-control"] == "no-store"
    assert redeem(client, code).status_code == 401


def test_wrong_pkce_cannot_redeem_or_consume(browser):
    client, _ = browser
    code = issue(browser)
    client.cookies.clear()
    assert redeem(client, code, "x" * 43).status_code == 401
    assert redeem(client, code).status_code == 200


def test_expired_code_rejected(browser, db):
    client, _ = browser
    code = issue(browser)
    row = db.execute(select(DesktopHandoff)).scalar_one()
    row.expires_at = int(time.time()) - 1
    db.commit()
    client.cookies.clear()
    assert redeem(client, code).status_code == 401


def test_session_rotation_invalidates_code(browser, monkeypatch):
    client, _ = browser
    code = issue(browser)
    client.cookies.clear()
    monkeypatch.setattr(config, "WORKSPACE_SESSION_SECRET", "new-signing-key" * 4)
    assert redeem(client, code).status_code == 401


def test_handoff_requires_cookie_and_origin(client, oidc_settings):
    assert client.post("/v1/auth/desktop/handoff", json={"code_challenge": CHALLENGE}).status_code == 401


def test_handoff_rejects_cross_site(browser):
    client, _ = browser
    assert client.post("/v1/auth/desktop/handoff", json={"code_challenge": CHALLENGE}, headers={"Origin": "https://attacker.test"}).status_code == 403


@pytest.mark.parametrize("path", ["/v1/account/workspaces", "/v1/workspaces"])
def test_anonymous_denied(client, oidc_settings, path):
    assert client.get(path).status_code == 401


def test_anonymous_workspace_creation_denied(client, oidc_settings):
    assert client.post("/v1/workspaces", json={"name": "Attack"}).status_code == 401


def test_wrong_issuer_session_denied(client, oidc_settings):
    token, _ = mint_workspace_session(principal_from_claims({"sub": "a", "email": "a@example.test"}, "https://wrong.test"))
    assert client.get("/v1/account/workspaces", headers={"Authorization": f"Bearer {token}"}).status_code == 401
