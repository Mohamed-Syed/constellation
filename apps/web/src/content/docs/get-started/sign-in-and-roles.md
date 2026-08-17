# Sign in & roles

> How authentication and authorization work in Constellation: sign-in methods, the two built-in roles, and the full permission catalog.

## Signing in

Constellation supports two authentication modes:

| Mode | When | Details |
|---|---|---|
| **Local JWT** | Default, no configuration | Sign in with email + password. The API issues a JWT; the portal stores it (and an httpOnly SameSite cookie is also set for cookie-based calls). |
| **OIDC / SSO (Keycloak and compatible)** | When `OIDC_ISSUER_URL` is configured | Tokens are verified with RS256 against the issuer; `iss`, `aud`, and `exp` are enforced. The local verifier and the OIDC verifier coexist. |

- Sign out via the **Sign out** action in the portal (top bar menu).
- The login page is the same for both modes.

## The two built-in roles

On first boot the platform seeds two roles and two users:

| Role | User (default) | Permissions | Can |
|---|---|---|---|
| **admin** | `admin@constellation.local` / `changeme` | `platform:admin` (implies everything) | All management: users, roles, plugins, mesh, schedules, workflows, teams, AI Controller actions, audit export |
| **viewer** | `viewer@constellation.local` / `changeme` | `core:authenticated` only | Sign in and browse read-only surfaces; every management call returns **403 Forbidden** |

> **TIP:** Use the viewer account to verify that your permission model is actually enforced — try an admin action with the viewer session and watch it get a 403.

## How permissions work

- Permissions are **colon-scoped strings**: `<domain>:<resource>:<action>` (e.g. `core:mesh:manage`) or `<domain>:<action>` (e.g. `platform:admin`).
- Roles map to permission sets; the platform also supports wildcard matching (`platform:admin` satisfies every `core:*` requirement).
- The API is the real boundary: the portal only *hides* what you cannot use; the API *enforces* it (403).

## The permission catalog

| Permission | String | Grants |
|---|---|---|
| Platform admin | `platform:admin` | Everything (implies all below) |
| Plugin management | `core:plugin:manage` | Install/uninstall/enable plugins, catalog admin |
| User management | `core:user:manage` | Manage users |
| Role management | `core:role:manage` | Manage roles and role→permission mappings |
| Settings management | `core:settings:manage` | Change platform settings/feature flags |
| Audit read | `core:audit:read` | Read the audit log, export CSV/PDF, **read the AI Controller status** |
| AI Controller manage | `core:ai-controller:manage` | **Run AI Controller recovery actions** (`POST /act`) |
| Feature flag manage | `core:feature-flag:manage` | Toggle feature flags |
| Brain read | `core:brain:read` | Query and read the knowledge graph |
| Brain write | `core:brain:write` | Remember/append to the knowledge graph |
| Workflow manage | `core:workflow:manage` | CRUD and run workflows |
| Mesh manage | `core:mesh:manage` | Manage mesh peers and topology |
| Authenticated | `core:authenticated` | Baseline: signed in |

## Where roles are enforced

- **Portal sidebar** — items are hidden unless you hold at least one of the item's required permissions.
- **API routes** — every protected route declares required permissions; missing them returns `403 Forbidden`.
- **Audit log** — denied attempts are recorded too, so a 403 is always traceable.

## Changing credentials

The seed users read `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `VIEWER_EMAIL` / `VIEWER_PASSWORD` from the environment (`.env`) at boot. Change them there and restart the API — the seed only creates the users if they do not already exist.
