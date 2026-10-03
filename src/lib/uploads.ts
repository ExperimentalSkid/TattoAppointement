export class UploadBodyError extends Error {
  readonly code: "too_large" | "invalid_body";
  constructor(code: "too_large" | "invalid_body") {
    super(code);
    this.code = code;
  }
}

// Bound multipart parsing before a large body can be buffered by formData().
export async function readUploadFormData(request: Request, maxBytes: number) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new UploadBodyError("invalid_body");
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UploadBodyError("too_large");
  }
  if (!request.body) throw new UploadBodyError("invalid_body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new UploadBodyError("too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch {
    throw new UploadBodyError("invalid_body");
  }
}
