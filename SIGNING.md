# Signing & Release — fields to fill in

Compass inherits Helm's macOS build + Apple signing + release pipeline unchanged.
The **plumbing works as-is**; only the identity/credential fields below are stubbed
and must be filled before the first signed release. Reuse your **existing Apple
Developer identity** (the same one Helm ships with) — no new certificate needed.

## 1. Bundle identifier — `src-tauri/tauri.conf.json`

Currently a placeholder:

```json
"identifier": "com.jordanpapaleo.compass"
```

Confirm/adjust this to the bundle ID you register for Compass. It must be unique
from Helm's (`com.jordanpapaleo.helm`).

## 2. Apple signing credentials — `sign.sh`

`sign.sh` is present with **TODO placeholders** and is gitignored (never committed).
Fill in all four values (copy from your Helm `sign.sh`, or from your Apple Developer
account). A committed `sign.sh.example` documents the same fields.

| Env var | What it is |
|---------|-----------|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Name> (<TEAM_ID>)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | App-specific password (appleid.apple.com → Sign-In & Security) |
| `APPLE_TEAM_ID` | 10-char Apple Developer Team ID |

## 3. Icons (optional, cosmetic)

`src-tauri/icons/*` are currently **Helm's icons**, reused so the build works. Replace
with Compass artwork when ready (`npm run tauri icon path/to/icon.png` regenerates them).

## Building

```bash
source sign.sh          # loads credentials
npm run tauri build     # produces a signed .dmg
# — or —
./release.sh patch      # bump + changelog + tag + signed build
```

Until `sign.sh` is filled in, `./release.sh` will still run but the notarized/signed
step will fail — use plain `npm run tauri dev` / `npm run tauri build` for unsigned
local builds during development.
