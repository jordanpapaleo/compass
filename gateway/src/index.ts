import { serve } from "@hono/node-server";
import { PORT } from "./config.ts";
import { logPath } from "./log.ts";
import { applyToEnv } from "./providerConfig.ts";
import { createApp } from "./server.ts";

await applyToEnv(); // load app-managed provider keys into env before serving
const app = createApp();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`compass-gateway listening on http://localhost:${info.port}`);
  console.log(`routing log: ${logPath()}`);
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "ZAI_API_KEY"]) {
    console.log(`  ${k}: ${process.env[k] ? "configured" : "NOT SET"}`);
  }
});
