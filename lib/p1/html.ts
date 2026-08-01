export type Anchor = { href: string; text: string };

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function htmlToText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function extractAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  const pattern = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "").trim();
    const text = htmlToText(match[4] ?? "");
    if (href && text) anchors.push({ href, text });
  }
  return anchors;
}

export function extractFirstTagText(html: string, tag: "h1" | "title"): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  const value = match ? htmlToText(match[1]) : "";
  return value || null;
}

export function extractMetaContent(html: string, keys: string[]): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = attribute(tag, "name") ?? attribute(tag, "property");
    if (!name || !keys.some((key) => key.toLowerCase() === name.toLowerCase())) continue;
    const content = attribute(tag, "content");
    if (content) return decodeHtmlEntities(content).replace(/\s+/g, " ").trim();
  }
  return null;
}

export function extractJsonLdObjects(html: string): Record<string, unknown>[] {
  const objects: Record<string, unknown>[] = [];
  const pattern = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      collectJsonLd(JSON.parse(match[1].trim()), objects);
    } catch {
      // Invalid third-party JSON-LD is ignored; DOM rules remain available.
    }
  }
  return objects;
}

export function excerptAround(text: string, value: string, radius = 120): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const index = normalizedText.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return normalizedText.slice(0, radius * 2);
  return normalizedText.slice(Math.max(0, index - radius), Math.min(normalizedText.length, index + value.length + radius));
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#x") || key.startsWith("#X")) return safeCodePoint(Number.parseInt(key.slice(2), 16), entity);
    if (key.startsWith("#")) return safeCodePoint(Number.parseInt(key.slice(1), 10), entity);
    return ENTITY_MAP[key.toLowerCase()] ?? entity;
  });
}

function safeCodePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return fallback;
  return String.fromCodePoint(value);
}

function collectJsonLd(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLd(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  output.push(record);
  if ("@graph" in record) collectJsonLd(record["@graph"], output);
}
