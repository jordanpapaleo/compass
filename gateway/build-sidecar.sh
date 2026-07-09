#!/usr/bin/env bash
# Build the gateway into a single self-contained executable and place it where
# Tauri expects the sidecar (src-tauri/binaries/compass-gateway-<target-triple>).
#
# Run this before `npm run tauri build`. Requires Node >= 24 (for SEA) and the
# gateway's dev deps (esbuild, postject) installed.
#
# Usage: ./build-sidecar.sh
set -e
cd "$(dirname "$0")"

TRIPLE="$(rustc -vV | sed -n 's/host: //p')"
OUT="../src-tauri/binaries/compass-gateway-${TRIPLE}"
FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"

echo "→ bundling gateway → build/gateway.cjs"
npx esbuild src/index.ts --bundle --platform=node --format=cjs --target=node24 \
  --outfile=build/gateway.cjs

echo "→ generating SEA blob"
cat > build/sea-config.json <<EOF
{ "main": "build/gateway.cjs", "output": "build/sea-prep.blob", "disableExperimentalSEAWarning": true }
EOF
node --experimental-sea-config build/sea-config.json

echo "→ assembling executable for ${TRIPLE}"
mkdir -p ../src-tauri/binaries
cp "$(command -v node)" "$OUT"
codesign --remove-signature "$OUT" 2>/dev/null || true
npx postject "$OUT" NODE_SEA_BLOB build/sea-prep.blob \
  --sentinel-fuse "$FUSE" --macho-segment-name NODE_SEA
codesign --sign - "$OUT" 2>/dev/null || true

echo "✓ built $OUT"
