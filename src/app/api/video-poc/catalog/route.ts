import { NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const templatesRoot = resolve("public/templates");
  const productsRoot = resolve("public/products");

  const templates = readdirSync(templatesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => existsSync(join(templatesRoot, id, "metadata.json")))
    .map((id) => {
      const meta = JSON.parse(
        readFileSync(join(templatesRoot, id, "metadata.json"), "utf-8"),
      );
      return {
        id,
        video_url: `/templates/${id}/video.mp4`,
        first_frame_url: `/templates/${id}/first_frame.png`,
        outfit_slots: Math.max(1, meta.outfit_segments?.length ?? 1),
      };
    });

  const products = readdirSync(productsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => existsSync(join(productsRoot, id, "metadata.json")))
    .map((id) => {
      const meta = JSON.parse(
        readFileSync(join(productsRoot, id, "metadata.json"), "utf-8"),
      );
      return {
        id,
        image_url: `/products/${id}/image.png`,
        primary_item_type: meta.primary_item_type,
        overall_description: meta.overall_description,
      };
    });

  return NextResponse.json({ templates, products });
}
