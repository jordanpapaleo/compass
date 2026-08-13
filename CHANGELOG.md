## v0.2.1 — 2026-08-13

- chore: smoke-test the bundled gateway before committing release artifacts
- fix: grant the gateway sidecar allow-jit so it survives the hardened runtime

## v0.2.0 — 2026-08-12

- chore: harden release.sh — build sidecar, verify notarization, tag after build
- feat: chat as slide-out panel; gateway badge is the on/off switch
- chore: raise default max_tokens to 16000; ignore tsbuildinfo
- feat: model catalog — Opus 5 premium tier, always-visible model toggles
- chore: replace app icon with new Compass compass artwork
- feat: dashboard redesign per Claude design handoff
- feat: Anthropic-compatible /v1/messages endpoint (Claude Code support)
- feat: cross-provider failover + custom-provider auto-routing; insight polish
- feat: package as self-contained macOS app (bundled gateway sidecar)
- feat: generic custom providers; remove hardcoded Z.ai
- feat: in-app key management, built-in chat, gateway toggle, help menu
- docs: comprehensive README + tested usage examples
- feat: Day 4 — learning loop (observe → suggest → apply → adapt) + polish
- feat: Day 3 — personalization sliders that actually change routing
- feat(gateway): Ollama local provider — Day 1 gate passed
- feat(gateway): add Z.ai GLM-5.2 provider via OpenAI-compat adapter factory
- feat: Day 2 — git context provider + routing log UI with explainability
- feat(app): wire gateway as supervised Tauri sidecar + live status dashboard
- fix(gateway): update OpenAI tier models to live-verified gpt-5.4 family
- feat(gateway): Day 1 — OpenAI-compatible gateway with intent-based routing
- let there be code

# Changelog

## v0.1.0 — 2026-07-08
- Seed Compass from the Helm Tauri shell — retains the macOS build, Apple signing, and release pipeline; KM-specific app code and dependencies removed.
