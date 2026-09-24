import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { proofFile } from "@/lib/db";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return new NextResponse("Sign in.", { status: 401 });
  const { id } = await context.params;
  const file = proofFile(userId, id);
  if (!file?.file_path) return new NextResponse("Not found.", { status: 404 });
  const root = path.join(process.cwd(), "data", "uploads");
  const resolved = path.resolve(file.file_path);
  if (!resolved.startsWith(root)) return new NextResponse("Not found.", { status: 404 });
  const bytes = readFileSync(resolved);
  return new NextResponse(bytes, {
    headers: {
      "Content-Disposition": `inline; filename="${file.file_name || "proof"}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
