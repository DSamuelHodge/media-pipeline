export async function requireUploadToken(request: Request, token: string | undefined): Promise<Response | null> {
  if (!token) {
    return Response.json({ error: "UPLOAD_TOKEN is not configured" }, { status: 500 });
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) {
    return Response.json({ error: "missing bearer token" }, { status: 401 });
  }

  const provided = header.slice(prefix.length);
  if (!(await tokensEqual(provided, token))) {
    return Response.json({ error: "invalid token" }, { status: 401 });
  }

  return null;
}

async function tokensEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) {
    return false;
  }
  return crypto.subtle.timingSafeEqual(aBytes, bBytes);
}
