# Security policy

## Supported versions

Security fixes apply to the **main** branch of this repository. GZMO is intended as a **single-user local daemon** on Ubuntu with Ollama—not a multi-tenant internet service.

## Reporting a vulnerability

If you believe you have found a security issue:

1. **Do not** open a public issue with exploit details.
2. Contact the repository maintainer privately (use your org’s usual security channel, or open a minimal “security contact” issue asking for a private address if none is listed).
3. Include steps to reproduce, affected version/commit, and impact assessment.

We will acknowledge receipt and work on a fix or mitigation.

## Threat model (summary)

| Asset | Risk |
|-------|------|
| **Vault contents** | Local users/processes; malicious inbox YAML; symlink tricks in tools |
| **HTTP API** | Optional; must use `GZMO_API_TOKEN`, loopback bind, `GZMO_LOCAL_ONLY=1` |
| **Dropzone** | Untrusted files (PDF/DOCX/ZIP parsing) when enabled |
| **Ollama** | Prompts and vault excerpts sent to `OLLAMA_URL`; keep on localhost |
| **Logs / traces** | May contain task snippets under `$VAULT_PATH/GZMO/` |

## Dependency provenance

GZMO bundles `pdf-parse` (v2.4.5) from the `mehmet-kozan/pdf-parse` fork (Apache-2.0), not the original unmaintained npm package. When auditing dependencies, verify lockfile integrity (`bun.lock`) and use `bun install --frozen-lockfile` in CI.

## Secure configuration checklist

When enabling the HTTP API:

```bash
GZMO_API_ENABLED=1
GZMO_API_HOST=127.0.0.1
GZMO_API_PORT=12700
GZMO_LOCAL_ONLY=1
GZMO_API_TOKEN="<strong-random-secret>"
```

Do **not** set `GZMO_API_ALLOW_INSECURE=1` in production.

Do **not** bind the API to `0.0.0.0` without a token and TLS termination you control.

## Out of scope

- Windows / macOS deployments (unsupported per AGENTS.md)
- Hardening Ollama itself (use network isolation and upstream guidance)
- Physical access to the machine (full-disk encryption, OS account controls)
