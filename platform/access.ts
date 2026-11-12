/** Cloudflare Access JWT 校验：/admin 的第二道防护。任何异常一律视为不通过。 */

type Jwk = JsonWebKey & { kid?: string };

function decodeSegment(segment: string): Uint8Array {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(decodeSegment(segment))) as Record<string, unknown>;
}

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; now: number; fetchJwks(url: string): Promise<unknown> },
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decodeJson(headerPart);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
    const payload = decodeJson(payloadPart);
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(opts.aud)) return false;
    if (payload.iss !== `https://${opts.teamDomain}`) return false;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= opts.now) return false;
    const jwks = (await opts.fetchJwks(`https://${opts.teamDomain}/cdn-cgi/access/certs`)) as { keys?: Jwk[] };
    const jwk = jwks.keys?.find((key) => key.kid === header.kid);
    if (!jwk) return false;
    const { kid: _kid, ...keyData } = jwk;
    void _kid;
    const key = await crypto.subtle.importKey("jwk", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeSegment(signaturePart) as BufferSource,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
  } catch {
    return false;
  }
}
