import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Dev-only: saves a canvas snapshot posted by the page (data URL) under art/library/build/snapshots,
 * so renders can be checked even when the browser isn't painting to screen. 404s in production.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const { name, dataUrl } = (await request.json()) as { name?: string; dataUrl?: string };
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl ?? "");
  const safe = (name ?? "snapshot").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  if (!match) return new Response("Expected a PNG or JPEG data URL", { status: 400 });
  const dir = path.resolve(process.cwd(), "../../art/library/build/snapshots");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${safe}.${match[1] === "jpeg" ? "jpg" : "png"}`);
  await writeFile(file, Buffer.from(match[2]!, "base64"));
  return Response.json({ file });
}
