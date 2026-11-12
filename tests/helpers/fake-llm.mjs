/** 测试用大模型替身与 fetch 替身。 */
export function fakeLlm(responses) {
  const calls = [];
  let index = 0;
  return {
    calls,
    async completeJson(messages) {
      calls.push(messages);
      const next = typeof responses === "function" ? responses(messages) : responses[Math.min(index++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return { json: next, usage: { promptTokens: 100, completionTokens: 50 } };
    },
  };
}

export function fakeFetch(handler) {
  const requests = [];
  const fn = async (url, init = {}) => {
    const request = { url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null, signal: init.signal };
    requests.push(request);
    return handler(request);
  };
  fn.requests = requests;
  return fn;
}

export function deepSeekReply(content, usage = { prompt_tokens: 10, completion_tokens: 5 }) {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
