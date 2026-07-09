import { serve } from "@hono/node-server";
import { PORT } from "./config.ts";
import { logPath } from "./log.ts";
import { applyToEnv } from "./providerConfig.ts";
import { rebuildCustomAdapters } from "./registry.ts";
import { createApp } from "./server.ts";

// Wrapped in an async IIFE (not top-level await) so the gateway can be bundled
// to CommonJS for a single-executable build. Runs unchanged under `node`.
async function main() {
  await applyToEnv(); // load app-managed provider keys into env before serving
  await rebuildCustomAdapters(); // build adapters for user-added custom providers
  const app = createApp();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`compass-gateway listening on http://localhost:${info.port}`);
    console.log(`routing log: ${logPath()}`);
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"]) {
      console.log(`  ${k}: ${process.env[k] ? "configured" : "NOT SET"}`);
    }
  });
}

main().catch((err) => {
  console.error("compass-gateway failed to start:", err);
  process.exit(1);
});
