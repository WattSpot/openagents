# OpenAgents Workspace

A managed agent collaboration environment built on the [OpenAgents Network Model](../docs/openagents_network_model.md).

## Upgrading

For the v1.1 collaboration release, see the [migration note](docs/migrate-to-v1.1.md), including device ownership, sharing changes and rollout steps.

## Quick Start

```bash
# Start everything (PostgreSQL + backend + frontend)
cd workspace
make dev

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

## Architecture

```
workspace/
├── backend/          FastAPI + SQLAlchemy (event-native API)
├── frontend/         Next.js + React (workspace UI)
└── docker-compose.yml
```

The workspace backend implements the ONM event protocol:
- `POST /v1/events` — send events into the network pipeline
- `GET /v1/events` — poll events from the network
- `POST /v1/join` / `POST /v1/leave` — agent lifecycle
- `GET /v1/discover` — discover agents, channels, resources

Events flow through a mod pipeline: `mod/auth` → `mod/workspace` → `mod/persistence`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:dev@localhost:5432/openagents_workspace` | PostgreSQL connection |
| `AUTH_MODE` | `workspace_token` | Human auth mode: `workspace_token`, `firebase`, or `oidc` |
| `IDENTITY_MODE` | `standalone` | Agent identity: `standalone` or `shared` |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `AGENT_TIMEOUT_SECONDS` | `60` | Seconds before agent is considered offline |

`AUTH_MODE=oidc` rejects wildcard CORS. Set `CORS_ORIGINS` to the exact frontend origin before enabling OIDC. `OIDC_ALLOW_INSECURE_HTTP=true` is intended only for loopback development; production must leave it false.

## Authentication modes

Workspace keeps human login separate from agent and workspace machine credentials.

1. `workspace_token` is the original self-hosted mode. Workspace and per-node tokens continue to work without a human identity provider.
2. `firebase` keeps the existing hosted Google/Firebase login and `POST /v1/auth/session` handoff. Existing Firebase deployments do not need OIDC settings or a Firebase configuration change.
3. `oidc` adds standards-compliant browser login for self-hosted human users. The backend uses Authlib discovery and Authorization Code Flow with PKCE; the provider must expose compatible discovery, authorization, token, and JWKS endpoints and return the configured email claim in the validated ID token or userinfo response.

OIDC identity is keyed by the exact issuer and `sub` claim. The email claim is required for this first slice; email-less accounts and explicit account linking are out of scope. A new OIDC subject with an email that already belongs to another account is rejected rather than silently linked, except when that address belongs to an unclaimed invitation placeholder. After authentication, the existing `User` and `WorkspaceMembership` role checks apply; this contribution does not map provider groups to roles.

`OIDC_REQUIRE_EMAIL_VERIFICATION=true` is the secure default for email-bound invitations. Some providers omit the optional `email_verified` claim; only set it to `false` when the operator has independently established that the configured issuer's signed email claim is trustworthy.

### OIDC configuration

Set these only on the backend. Never put `OIDC_CLIENT_SECRET` in a `NEXT_PUBLIC_*` variable:

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://issuer.example.com/tenant
OIDC_CLIENT_ID=<application-client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_SCOPES=openid profile email
OIDC_EMAIL_CLAIM=email
OIDC_NAME_CLAIM=name
OIDC_REQUIRE_EMAIL_VERIFICATION=true
OIDC_REDIRECT_URI=https://api.example.com/v1/auth/oidc/callback
WORKSPACE_SESSION_SECRET=<long-random-secret>
FRONTEND_BASE_URL=https://workspace.example.com
PUBLIC_API_BASE=https://api.example.com
CORS_ORIGINS=https://workspace.example.com
```

Register the exact `OIDC_REDIRECT_URI` with the provider. The frontend obtains public auth capabilities from `GET /v1/auth/config`; it does not receive the client secret. The callback sets an HttpOnly, Secure, SameSite=Lax browser session cookie. OIDC API calls use that cookie through the backend middleware; the local session JWT is never returned to JavaScript or browser storage. SameSite=Lax assumes the frontend and API share a site-compatible origin; cross-site deployments need a separate deployment design. OIDC mode requires an explicit non-wildcard `CORS_ORIGINS` value containing `FRONTEND_BASE_URL`, and production deployments must use HTTPS. Logout clears the local cookie and follows the provider's discovered end-session endpoint when one is advertised; this first slice does not send `id_token_hint` or otherwise guarantee upstream provider-session termination. The session JWT is stateless, so logout cannot revoke an already-issued token.

Provider interoperability is not certified by the unit tests. Validate discovery, claim mapping, and logout behavior against the selected provider before production rollout.

## Self-Hosting

### Run Backend Locally (with external PostgreSQL)

```bash
cd workspace/backend
pip install -r requirements.txt

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
alembic upgrade head

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Connect Agents

```bash
# Create a workspace
curl -X POST https://your-endpoint/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "my-workspace"}'
# Returns: { "data": { "token": "<TOKEN>", "slug": "<SLUG>" } }

# Connect an agent
openagents create claude --name my-agent \
  --join-workspace <TOKEN> \
  --endpoint https://your-endpoint \
  --no-browser
```

### Run Frontend Locally

```bash
cd workspace/frontend
npm install
NEXT_PUBLIC_API_URL=https://your-endpoint npm run dev
```

### Deploy Frontend to Vercel / Insforge

The frontend uses `output: 'standalone'` in `next.config.mjs` for Docker deployments.
When deploying to Vercel or Insforge, remove that setting before deploying so the
platform can handle the build natively:

```js
// next.config.mjs — for Vercel/Insforge deployment
const nextConfig = {};
export default nextConfig;
```

Set the environment variable `NEXT_PUBLIC_API_URL` to your backend URL (e.g. `https://your-backend.example.com`).

## Development

```bash
# Run backend tests
make test

# Run database migrations
make migrate

# Create new migration
make migration msg="add_new_table"

# Reset database
make reset-db
```


## Shared issues

Issues are durable workspace discussions for ideas, problems, and decisions.
They are available before any agent connects. Creating an issue, commenting,
linking a thread, or adding a task never starts agent work.

- Browse issues as a list or board, search them, and filter by Open, In progress,
  or Closed. The same issue remains the home for discussion as its scope evolves.
- Type **@** in a comment or issue description to search workspace people and
  agents, including offline teammates. Select with the mouse, arrow keys and
  Enter/Tab; Escape dismisses the picker. Mentions keep stable identities in the
  saved text and render with display names. They do not send notifications or
  start agent work; use **Bring in an agent** to request execution.
- Choose **Bring in an agent**, select workspace agents, and give them an
  instruction to start a linked execution thread. The kickoff includes the issue
  description and the latest 20 discussion entries (bounded in size).
- Link an existing thread, or select one when creating an issue to preserve the
  connection to an earlier conversation.
- Create a scoped task or link an existing task. New tasks enter Backlog and are
  assigned/run from the existing task board; their kickoff includes issue context.
- Share the latest agent reply from linked work into the discussion. Shared
  results retain the agent's attribution and cannot be duplicated. Agent replies
  do not automatically close the issue; the team reviews the outcome and closes
  or reopens it. Status changes remain in the discussion history.
- Copy an issue link for another workspace member. The link excludes workspace
  credentials; recipients authenticate through the existing workspace access flow.

Before running this version against an existing database, apply migration `056`
with `alembic upgrade head` from `workspace/backend`.

The API is under `/v1/issues`, with `network=<workspace id or slug>` on every
request. It uses the existing workspace-token or bearer authentication. Identity
viewers can read; members can write. Machine credentials retain their existing
workspace-wide trust. Verified human identities override client-supplied authors.

| Method | Path | Action |
|---|---|---|
| GET / POST | `/v1/issues` | List (paginated, with `q` / `status` filters) / create |
| GET / PATCH | `/v1/issues/{id}` | Discussion and linked work / edit or change status |
| POST | `/v1/issues/{id}/comments` | Comment, or share a linked `source_event_id` |
| POST | `/v1/issues/{id}/links` | Link an existing `channel_name` |
| POST | `/v1/issues/{id}/threads` | Start selected `agents` with an `instruction` |
| POST | `/v1/issues/{id}/tasks` | Create a scoped task or link a `task_id` |
