# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-08-26

### Added
- **4.5 Multimodal** — `ContentPart` (text + image) across engine, providers, and canvas.
- **4.7 Human-in-the-loop** — gate approve / edit / reject / scrap with run-halt webhook.
- **4C.7 Plugin process isolation** — `child_process.fork` with env trimming and fetch/fs proxy allowlists.
- **4D.7 MCP remote transports** — `stdio` / `http` / `sse` servers and tool-call permission governance.
- **4.9 Engineering**
  - GitHub Actions CI (typecheck + build + test) and gitleaks secret-leak scan.
  - CORS restricted to `CORS_ORIGINS` (was allow-all) plus basic security response headers.
  - Dockerfile + `docker-compose.yml` deployment.
  - MIT `LICENSE`.

### Changed
- CORS now requires `CORS_ORIGINS` in shared deployments; local dev keeps allow-all when unset.

## [0.1.0] - 2026-08-01

### Added
- Initial agent-world event-sourced pipeline engine, worker plugin system, triggers, MCP integration, and web canvas.
