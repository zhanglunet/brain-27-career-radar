/** 测试用搜索替身：按检索词返回固定结果，记录收到的检索词。 */
export function fakeSearch(map) {
  const queries = [];
  return {
    queries,
    async search(query) {
      queries.push(query);
      const result = typeof map === "function" ? map(query) : (map[query] ?? map["*"] ?? []);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

export const hit = (url, title = "示例页面", extra = {}) => ({ title, url, summary: null, siteName: null, datePublished: null, ...extra });
