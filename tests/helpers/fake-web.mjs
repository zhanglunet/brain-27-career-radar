/** 测试用网页 fetch 替身：按 URL 返回登记的响应，未登记的返回 404，记录请求。 */
export function fakeWeb(pages) {
  const requests = [];
  const fn = async (url, init = {}) => {
    const key = String(url);
    requests.push({ url: key, headers: new Headers(init.headers), redirect: init.redirect });
    const page = pages[key];
    if (!page) return new Response("not found", { status: 404 });
    if (page.error) throw page.error;
    if (page.redirect) return new Response(null, { status: 302, headers: { location: page.redirect } });
    const body = typeof page.body === "function" ? page.body() : page.body;
    return new Response(body, { status: page.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...(page.headers ?? {}) } });
  };
  fn.requests = requests;
  return fn;
}

export const html = (body, title = "示例页面") => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
