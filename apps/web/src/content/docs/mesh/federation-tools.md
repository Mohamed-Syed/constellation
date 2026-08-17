# Federated tools & SSO

> Heavyweight tools are not reimplemented — they are federated as tiles behind the portal, protected by the same identity story.

## The federation registry

`config/modules.yaml` declares federated modules. The portal's **Tools** page (`/tools`) renders them as tiles, each backed by a reverse-proxied path (Caddy in the federation overlay).

| Module | What the tile opens |
|---|---|
| Grafana | The dashboards |
| Keycloak | Identity admin |
| Langflow | Flow building |
| Open Web UI | Chat UI |
| (others per config) | … |

## The SSO story

- The portal and the federated tools share one identity: OIDC (Keycloak) with RS256 tokens, `iss`/`aud`/`exp` enforced.
- The API's composite verifier accepts both local JWTs and OIDC tokens — verifiers coexist; a tampered token is rejected with 401.
- The federation overlay is booted with the docker compose federation profile (see **Deployment**).

## Tiles are links, not iframes

Each tile deep-links into the federated tool behind the proxy. The portal does not re-host the tool's UI — it federates it, which keeps the platform light and the tools upgradeable independently.

## Enabling SSO

1. Set `OIDC_ISSUER_URL` (and the OIDC client details) in `.env`.
2. Restart the API.
3. Sign in through the identity provider; the portal and tiles then share the session.

> **NOTE:** With SSO unset, the platform runs on local JWT accounts (admin/viewer) — everything else behaves identically.
