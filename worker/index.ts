/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { monitorSources } from "../lib/source-monitor";
import { syncAcademicPapers } from "../lib/academic-monitor";
import { translatePendingPapers } from "../lib/paper-translator";
import { refreshIntelligenceReports } from "../lib/intelligence-reports";
import { discoverOrganizations } from "../lib/organization-discovery";
import { syncResearchPolicies } from "../lib/policy-monitor";

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({
            format: normalizeImageFormat(format),
            quality,
          });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(JSON.stringify({
      event: "radar.sync.scheduled",
      receivedAt: new Date().toISOString(),
      cron:controller.cron,
    }));
    if(controller.cron==="30 2,8,14,20 * * *"){
      ctx.waitUntil(syncResearchPolicies(env.DB,{trigger:"cron"}).then(()=>refreshIntelligenceReports(env.DB)).then(()=>undefined));
      return;
    }
    ctx.waitUntil(Promise.allSettled([
      monitorSources(env.DB, { trigger: "cron" }),
      syncAcademicPapers(env.DB, { trigger: "cron" }).then(() => translatePendingPapers(env.DB, env.AI)),
      discoverOrganizations(env.DB, { trigger: "cron" }),
    ]).then((results) => {
      const rejected=results.filter((item)=>item.status==="rejected");
      if(rejected.length)console.error(JSON.stringify({event:"radar.sync.pipeline_rejected",count:rejected.length}));
      return refreshIntelligenceReports(env.DB);
    }).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

export default worker;

function normalizeImageFormat(format: string): ImageOutputOptions["format"] {
  switch (format) {
    case "image/jpeg":
    case "image/png":
    case "image/gif":
    case "image/webp":
    case "image/avif":
    case "rgb":
    case "rgba":
      return format;
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    default:
      return "image/webp";
  }
}
