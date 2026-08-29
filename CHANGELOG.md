# Changelog

All notable changes are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- **Multi-select on canvas** — Shift+click plants/pipes to toggle selection; Shift+drag on empty backdrop draws a marquee box to select all plants inside; ⌘/Ctrl+A selects all plants.
- **Batch operations** — drag any selected plant to move the whole selection together (relative positions preserved); Delete/Backspace removes all selected plants and pipes at once.
- **First-load auto-fit** — the canvas auto-fits to all plants on first load so new users never see a blank board.
- **Viewport persistence** — pan/zoom state persists per graph in localStorage; refreshing or dispatching a new run no longer resets the viewport.
- **Node execution duration** — the Inspector shows how long each node ran (startedAt/finishedAt, formatted as ms/s/m/h/d).
- **Artifact attribution** — stored artifacts are now attributed to their source pipeline (`graph_id`) and role (`source`/`intermediate`/`final`) in the backend.

### Changed
- Left-drag on empty backdrop in select mode now pans the canvas (was marquee); marquee selection moved to Shift+drag.
- Removed unused `reset()` method from canvas store (the "适应" button's fit-to-bounds replaces it).
- Vite dev server port restored to 5173.

### Fixed
- Marquee selection coordinates now convert from viewport (SVG viewBox) space to content (graph) space, matching node x/y.
- Multi-select drag now snapshots selected node IDs at drag start, avoiding stale React closure state after a Shift+click toggle.
- Marquee selection now uses window-level pointer events (instead of React synthetic events + pointer capture on inner `<rect>`), preventing the selection rectangle from sticking to the cursor when pointerup is dropped.
- Added `pointercancel` listener so macOS trackpad gestures / system interruptions clean up the marquee instead of leaving it stuck.
- product-json parsing now tolerates a blocks-only array, and long-image export has end-to-end timeout protection (previously could hang on "生成中...").
- Removed the `max-height` on `product__body` so the sink content scrolls with the Inspector (previously nested scrolling made content unreachable).
- Inspector and Control Panel bodies now scroll internally.
- Upstream prohibited terms / brand words are now injected into every agent node's input (previously omitted).
- A `node.failed` event is emitted when a gate exhausts its rework attempts, so the failure reason is visible.
- Upstream image URIs are included in agent text input so product-json can reference real images.
- Bare media extraction now skips URLs inside fenced code blocks.

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
