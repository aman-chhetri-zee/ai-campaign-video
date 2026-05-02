// scripts/ingest-products.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { analyzeProduct } from "../src/lib/pipeline/product-analysis";

async function main() {
  const root = resolve("public/products");
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const id of ids) {
    const dir = join(root, id);
    const imagePath = join(dir, "image.png");
    const metaPath = join(dir, "metadata.json");

    if (!existsSync(imagePath)) {
      console.warn(`[ingest-products] skipping ${id}: no image.png`);
      continue;
    }
    if (existsSync(metaPath)) {
      console.log(`[ingest-products] skipping ${id}: metadata.json exists (delete to re-ingest)`);
      continue;
    }

    console.log(`[ingest-products] processing ${id}...`);
    const metadata = await analyzeProduct({
      imageBytes: readFileSync(imagePath),
      mimeType: "image/png",
    });
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.log(`  -> wrote metadata.json`);
  }
  console.log("[ingest-products] DONE");
}

main().catch((err) => {
  console.error("[ingest-products] FAIL:", err);
  process.exit(1);
});
