import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const localD1Id = "00000000-0000-0000-0000-000000000027";
const productionD1Id = process.env.BRAIN_RADAR_D1_ID;
const useRemoteD1InDevelopment = process.env.BRAIN_RADAR_REMOTE_D1 === "true";

const localBindingConfig = {
  name: "brain-27-career-radar",
  main: "./worker/index.ts",
  workers_dev: true,
  compatibility_date: "2026-07-31",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [{
    binding: "DB",
    database_name: "brain-27-career-radar",
    database_id: productionD1Id ?? localD1Id,
    ...(productionD1Id ? {} : { preview_database_id: localD1Id }),
    ...(useRemoteD1InDevelopment ? { remote: true } : {}),
    // The Vite plugin rewrites this relative to dist/server/wrangler.json.
    migrations_dir: "drizzle",
  }],
  assets: { binding: "ASSETS" },
  images: { binding: "IMAGES" },
  ai: { binding: "AI" },
  routes: productionD1Id
    ? [
        { pattern: "openagent.hk", custom_domain: true },
        { pattern: "www.openagent.hk", custom_domain: true },
        { pattern: "radar.openagent.hk", custom_domain: true },
      ]
    : [],
  triggers: { crons: ["0 1,7,13,19 * * *", "30 2,8,14,20 * * *"] },
  observability: {
    enabled: true,
    logs: { head_sampling_rate: 1 },
    traces: { enabled: true, head_sampling_rate: 0.05 },
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
