/** 测试用 R2 替身：内存对象存储，支持分页 list 与故障注入。 */
export function createFakeR2({ pageSize = 1000, failDelete = false } = {}) {
  const store = new Map();
  return {
    async put(key, value, opts = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
      store.set(key, { bytes, httpMetadata: opts.httpMetadata ?? {} });
      return { key };
    },
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        key,
        httpMetadata: item.httpMetadata,
        body: new Response(item.bytes).body,
        async arrayBuffer() { return item.bytes.slice().buffer; },
      };
    },
    async delete(keys) {
      if (failDelete) throw new Error("r2 unavailable");
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    async list({ prefix = "", cursor, limit } = {}) {
      const all = [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const size = Math.min(limit ?? pageSize, pageSize);
      const objects = all.slice(start, start + size).map((key) => ({ key }));
      const truncated = start + size < all.length;
      return { objects, truncated, cursor: truncated ? String(start + size) : undefined };
    },
    keys() { return [...store.keys()].sort(); },
  };
}
