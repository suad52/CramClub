import { clientKey, createRateLimiter, errorResponse } from "@/lib/ai/http";
import { studioErrorResponse } from "@/lib/learning-studio/routeErrors";
import { MAX_PDF_BYTES, extractPdf } from "@/lib/learning-studio/server";

export const runtime = "nodejs";
const allow = createRateLimiter(10, 60_000);

/** POST multipart { file: PDF } → { pages: string[] }. The PDF is read in memory and not stored. */
export async function POST(request: Request) {
  if (!allow(clientKey(request)))
    return errorResponse("rate_limited", "Too many uploads at once. Wait a minute.", 429);
  let file: FormDataEntryValue | null = null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return errorResponse("bad_request", "Send the PDF as form data in a field called file.", 400);
  }
  if (!(file instanceof File)) return errorResponse("bad_request", "Choose a PDF to upload.", 400);
  if (!file.name.toLowerCase().endsWith(".pdf") || (file.type && file.type !== "application/pdf")) {
    return errorResponse("bad_request", "Only PDF files are supported for now.", 400);
  }
  if (file.size === 0) return errorResponse("bad_request", "That file is empty.", 400);
  if (file.size > MAX_PDF_BYTES)
    return errorResponse("bad_request", "That PDF is over 15 MB.", 400);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
      return errorResponse("bad_request", "That file isn't a PDF.", 400);
    }
    return Response.json({ pages: await extractPdf(bytes) });
  } catch (err) {
    return studioErrorResponse(err, "extract");
  }
}
