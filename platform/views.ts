/** 极简服务端页面。所有用户可控内容都必须经 escapeHtml。 */
import { escapeHtml } from "./http.ts";
import type { User } from "./data/tables.ts";

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6b66;--line:#d9d6cf;--accent:#2f5d50;--danger:#a3362a}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--muted:#9a9a93;--line:#3a3a36;--accent:#7fb8a4;--danger:#e2786c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 64px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:24px}
nav{display:flex;gap:12px;flex-wrap:wrap;align-items:center}a{color:var(--accent)}h1{font-size:1.4rem;margin:0 0 16px}
form{display:grid;gap:10px;margin:16px 0}label{display:grid;gap:4px;font-size:.95rem}input,textarea{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;width:100%}
textarea{min-height:120px}button{font:inherit;padding:8px 14px;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:var(--bg);cursor:pointer;justify-self:start}
button.link{background:none;border:none;color:var(--accent);padding:0;text-decoration:underline}button.danger{background:var(--danger);border-color:var(--danger)}
.notice{border:1px solid var(--line);border-radius:6px;padding:10px 12px}.error{border-color:var(--danger);color:var(--danger)}.muted{color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:.95rem}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
code{word-break:break-all}ul.cards{list-style:none;padding:0;display:grid;gap:12px}ul.cards li{border:1px solid var(--line);border-radius:6px;padding:12px}
`;

export function layout(title: string, body: string, user: User | null = null): string {
  const nav = user
    ? `<nav><a href="/">我的目标</a><a href="/account">账号</a>${user.role === "admin" ? '<a href="/admin">管理</a>' : ""}<form method="post" action="/logout" style="margin:0"><button class="link" type="submit">退出</button></form></nav>`
    : `<nav><a href="/login">登录</a><a href="/register">注册</a></nav>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main><header><strong>求职空间</strong>${nav}</header>${body}</main></body></html>`;
}

export function notice(message: string, kind: "info" | "error" = "info"): string {
  return `<p class="notice${kind === "error" ? " error" : ""}">${escapeHtml(message)}</p>`;
}

export function messagePage(title: string, message: string, user: User | null = null, kind: "info" | "error" = "info"): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1>${notice(message, kind)}`, user);
}

export function field(label: string, name: string, type = "text", extra = ""): string {
  return `<label>${escapeHtml(label)}<input name="${name}" type="${type}" ${extra}></label>`;
}
