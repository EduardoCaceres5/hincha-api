import crypto from "crypto";
import { withCORS, preflight } from "@/lib/cors";
import { NextRequest } from "next/server";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME!;
  const api_key = process.env.CLOUDINARY_API_KEY!;
  const api_secret = process.env.CLOUDINARY_API_SECRET!;
  const timestamp = Math.round(Date.now() / 1000);
  const params = `timestamp=${timestamp}`;
  S;
  const signature = crypto
    .createHash("sha1")
    .update(params + api_secret)
    .digest("hex");
  return new Response(
    JSON.stringify({ timestamp, signature, api_key, cloud_name }),
    withCORS({ status: 200 })
  );
}
