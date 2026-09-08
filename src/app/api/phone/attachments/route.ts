import { requirePhoneAccess } from "@/lib/phone-access.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasExpectedFileSignature } from "@/lib/storage/file-integrity";
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
export async function POST(request: Request) {
  try {
    if (
      request.headers.get("origin") !==
      new URL(process.env.NEXT_PUBLIC_APP_URL!).origin
    )
      return json({ error: "Forbidden" }, 403);
    const w = await requirePhoneAccess();
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Choose an image." }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 4_100_000) {
        await reader.cancel();
        return json({ error: "Images must be smaller than 4 MB." }, 413);
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > 4_000_000 ||
      !["image/jpeg", "image/png"].includes(file.type)
    )
      return json(
        { error: "Choose a JPEG or PNG image smaller than 4 MB." },
        400,
      );
    const image = new Uint8Array(await file.arrayBuffer());
    if (!hasExpectedFileSignature(image, file.type))
      return json(
        { error: "The file contents do not match the image type." },
        400,
      );
    const path = `${w.organization.id}/${w.identity.userId}/${crypto.randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
    const saved = await createAdminClient()
      .storage.from("phone-attachments")
      .upload(path, image, { contentType: file.type, upsert: false });
    if (saved.error) throw saved.error;
    return json({ path, name: file.name }, 201);
  } catch (e) {
    return e instanceof Response
      ? e
      : json({ error: "The attachment could not be uploaded." }, 503);
  }
}
