const TRACKING_PARAMETERS = new Set([
  "from",
  "gclid",
  "ref",
  "source",
  "spm",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_source",
  "utm_term",
]);

export function canonicalizeUrl(input: string, base?: string): string | null {
  try {
    const url = new URL(input, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = normalizePath(url.pathname);
    return url.toString();
  } catch {
    return null;
  }
}

export function sameRegistrableHost(left: string, right: string): boolean {
  try {
    const leftHost = new URL(left).hostname.replace(/^www\./, "");
    const rightHost = new URL(right).hostname.replace(/^www\./, "");
    return leftHost === rightHost || leftHost.endsWith(`.${rightHost}`) || rightHost.endsWith(`.${leftHost}`);
  } catch {
    return false;
  }
}

function normalizePath(pathname: string): string {
  const compact = pathname.replace(/\/{2,}/g, "/");
  if (compact === "/") return compact;
  return compact.replace(/\/$/, "");
}
