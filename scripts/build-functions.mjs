/**
 * Bundles the shared TS game engine (+ dictionary data) into a single
 * self-contained ESM file the Supabase Edge Functions can import:
 *
 *   supabase/functions/_shared/engine.mjs
 *
 * Run before `supabase functions deploy`:
 *   npm run build:functions
 */

import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("supabase/functions/_shared", { recursive: true });

const result = await build({
  entryPoints: ["src/server/edgeEngine.ts"],
  outfile: "supabase/functions/_shared/engine.mjs",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  // Keep everything in one file (Deno edge runtime imports it directly).
  splitting: false,
  minify: false,
  logLevel: "info",
});

if (result.errors.length > 0) {
  process.exit(1);
}
console.log("Edge engine bundle written to supabase/functions/_shared/engine.mjs");
