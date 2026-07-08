# Compass

Compass is a **personal AI routing layer** — a local, personalized gateway that routes
each AI request to the right provider/model based on intent, preferences, cost, latency,
and learned history. You ask for *work to be done*, not for a specific model.

It runs as an **OS app, not a web app**: a local always-on gateway (a Node/TS sidecar)
sits in front of your tools (Claude Code, Cursor, CLI) and reads local context; a Tauri
desktop dashboard is the "mission control" surface on top.

> Full product spec, 4-day plan, and evaluation rubric live in the project note
> (`AI Gateway/01kx1aket8krs5hvrjsjrwc8rz.md`).

## Status

**Seed.** This repo is the starting skeleton — the Tauri shell, build, and signing
pipeline work, but the gateway, routing engine, and dashboard are not built yet.

## Stack

- **Tauri + Rust** — desktop shell, native menu, macOS packaging
- **React 19 + TypeScript + Vite** — dashboard frontend
- **Tailwind CSS 4 + DaisyUI** — styling
- **Biome** — lint/format · **Vitest** — tests
- Provider calls (to be added in the sidecar) use **raw provider SDKs** —
  `@anthropic-ai/sdk`, `openai`, `@google/genai`. **No** Vercel AI Gateway / AI SDK.

## Getting started

```bash
npm install
npm run tauri dev     # run the desktop app (or: npm start)
npm run build         # typecheck + build frontend
npm test              # run unit tests
npm run lint          # biome
```

## Seed provenance

Derived from **Helm** (`../helm`), a shipping macOS app, to inherit its proven Tauri
shell + Apple signing + release pipeline rather than rebuild boilerplate. Removed on
seeding: the KM app code (note editor, vault, graph/kanban/eisenhower views) and its
dependencies (tiptap, dnd-kit, force-graph, recharts, lowlight, gray-matter, minisearch,
etc.). Kept: the build config, Rust shell, and release scripts.

## Before first signed release

See [SIGNING.md](./SIGNING.md) — confirm the bundle identifier and fill in the Apple
signing credentials in `sign.sh` (placeholders for now).

## Layout

```
src/                 React dashboard (minimal shell — build here)
src-tauri/           Rust/Tauri shell, menu, config, icons
release.sh           version bump + changelog + tag + signed build
sign.sh(.example)    Apple signing credentials (gitignored; fill in)
SIGNING.md           what to fill in before releasing
```
