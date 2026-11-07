# -*- coding: utf-8 -*-
"""PRD-295/T2（trend issue #1477）：求职指令 @机会/@档案引用解析最小实现。

按 T1 设计（docs/plans/2026-11-04-prd-295-at-opportunity-profile-ref-design.md）
§3/§4/§5/§6 实现：

  - parse(raw)：@机会id / @档案vX（**版本显式必填**，R4）/ 组合解析；禁止
    形态（缺版本/节锚/相对词/双写）抛 RefSyntaxError；
  - resolve(raw, opportunities, profile_versions)：候选集注入纯函数（零
    文件零网络）；精确匹配，候选数裁决：1 → Resolution；0 → REF_NOT_FOUND；
    >1 → REF_AMBIGUOUS；档案版本存在但已回滚作废 → PROFILE_VERSION_GONE
    （不猜就近可用版）。**二值返回** Resolution | Refusal；
  - Resolution.meta_summary：公司/角色形态+摘要指纹——档案全文零搬运
    （「不复制」：内容走既有批准门执行链，本模块不搬运）；
  - **批准门不变**：本模块零 approval_dispatch 执行方法导入（T4 AST 断言
    预埋，T1 §7）；
  - RefAudit：解析审计（§6）——append-only 只增不删、成败都记、ts 注入。

零网络；示例全虚构占位。
测试：tests/test_prd295_t2_record_ref.py
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

REF_SCHEMA = "ref-resolution/v1"
OPP_RE = re.compile(r"^@(?P<opp>opp-[^@\s#]+)$")
PROFILE_RE = re.compile(r"^@档案(?P<version>v\d+(?:\.\d+)*)$")


class RefSyntaxError(ValueError):
    """§3.2 禁止形态——出现即拒绝，不尝试理解。"""


def _digest(profile: dict[str, Any]) -> str:
    canonical = json.dumps(profile, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"))
    return "sha16:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def parse(raw: str) -> dict[str, Any]:
    """引用语法解析：{kind: opportunity|profile, opportunity_id?, version?}。"""
    if not isinstance(raw, str) or not raw.strip():
        raise RefSyntaxError(f"引用为空或非字符串：{raw!r}")
    token = raw.strip()
    if token.startswith("@@") or "@" in token[1:] or '"' in token:
        raise RefSyntaxError(f"禁止形态（双写/引号/内嵌@）：{raw!r}（§3.2）")
    if token.startswith("@最新") or token.startswith("@当前"):
        raise RefSyntaxError(f"相对词不是 id：{raw!r}（§3.2）")
    m = PROFILE_RE.match(token)
    if m:
        return {"kind": "profile", "opportunity_id": None,
                "version": m.group("version")}
    m = OPP_RE.match(token)
    if m:
        if "#" in token:
            raise RefSyntaxError(f"引用不带节锚：{raw!r}（§3.2）")
        return {"kind": "opportunity", "opportunity_id": m.group("opp"),
                "version": None}
    if token.startswith("@档案"):
        raise RefSyntaxError(
            f"档案引用版本必须显式（@档案vX）——回滚后『当前』有歧义：{raw!r}（§3.2/R4）")
    if token.startswith("@机会") and "#" in token:
        raise RefSyntaxError(f"引用不带节锚：{raw!r}（§3.2）")
    raise RefSyntaxError(f"引用须为 @机会id / @档案vX：{raw!r}（§3.1）")


def resolve(raw: str, opportunities: list[dict[str, Any]],
            profile_versions: list[dict[str, Any]]) -> dict[str, Any]:
    """@名→记录 解析（§4.2）：精确匹配 + 候选数裁决 + 作废版本显形。

    opportunities：[{"opportunity_id","company","role"}]；
    profile_versions：[{"version","profile","revoked"}]（注入）。
    返回 Resolution | Refusal（二值，T1 §5）。
    """
    token = parse(raw)
    if token["kind"] == "opportunity":
        hits = [o for o in (opportunities or [])
                if o.get("opportunity_id") == token["opportunity_id"]]
        if len(hits) == 1:
            entry = hits[0]
            return {
                "schema": REF_SCHEMA, "raw": raw, "kind": "opportunity",
                "opportunity_id": entry["opportunity_id"], "profile_version": None,
                "meta_summary": {"company": entry.get("company"),
                                 "role": entry.get("role")},
                "resolution": {"status": "resolved", "candidates": 1,
                               "strategy": "exact"},
            }
        return _refusal(raw, "REF_NOT_FOUND" if not hits else "REF_AMBIGUOUS",
                        [o.get("opportunity_id") for o in hits], "机会 id")
    # 档案版本
    hits = [p for p in (profile_versions or [])
            if p.get("version") == token["version"]]
    if len(hits) == 1 and hits[0].get("revoked"):
        return _refusal(raw, "PROFILE_VERSION_GONE", [],
                        f"档案版本 {token['version']} 已被回滚作废——不猜就近可用版"
                        "（§5/R4）")
    if len(hits) == 1:
        profile = hits[0].get("profile") or {}
        return {
            "schema": REF_SCHEMA, "raw": raw, "kind": "profile",
            "opportunity_id": None, "profile_version": hits[0]["version"],
            "meta_summary": {"profile_digest": _digest(profile)},
            "resolution": {"status": "resolved", "candidates": 1,
                           "strategy": "exact"},
        }
    return _refusal(raw, "REF_NOT_FOUND" if not hits else "REF_AMBIGUOUS",
                    [p.get("version") for p in hits], "档案版本")


def _refusal(raw: str, code: str, candidates: list, detail: str) -> dict[str, Any]:
    return {
        "schema": REF_SCHEMA, "raw": raw, "kind": None,
        "opportunity_id": None, "profile_version": None, "meta_summary": None,
        "resolution": {"status": "refused", "error_code": code,
                       "candidates": candidates, "detail": detail},
    }


class RefAudit:
    """解析审计（§6）：append-only 只增不删、成败都记、ts 注入。"""

    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    def log(self, raw: str, outcome: dict[str, Any] | None, *, at: str) -> dict[str, Any]:
        res = (outcome or {}).get("resolution", {})
        entry: dict[str, Any] = {"ts": at, "raw": raw,
                                 "kind": (outcome or {}).get("kind")}
        if res.get("status") == "resolved":
            entry.update({"status": "resolved", "candidates": 1,
                          "resolved_ids": [outcome.get("opportunity_id")
                                           or outcome.get("profile_version")]})
        else:
            entry.update({"status": "refused", "candidates": res.get("candidates", []),
                          "error_code": res.get("error_code"),
                          "detail": res.get("detail")})
        self.records.append(entry)  # 只增不删
        return dict(entry)

    def resolve_logged(self, raw: str, opportunities: list[dict[str, Any]],
                       profile_versions: list[dict[str, Any]], *,
                       at: str) -> dict[str, Any]:
        """一步解析+留痕（语法错也记审计）。"""
        try:
            outcome = resolve(raw, opportunities, profile_versions)
        except RefSyntaxError as exc:
            entry = {"ts": at, "raw": raw, "kind": None, "status": "refused",
                     "candidates": [], "error_code": "REF_SYNTAX_ERROR",
                     "detail": str(exc)}
            self.records.append(entry)
            return {"refused": True, "error_code": "REF_SYNTAX_ERROR",
                    "detail": str(exc), "audit": entry}
        entry = self.log(raw, outcome, at=at)
        if outcome["resolution"]["status"] == "refused":
            return {"refused": True,
                    "error_code": outcome["resolution"]["error_code"],
                    "detail": outcome["resolution"].get("detail"), "audit": entry}
        return {"refused": False, "resolution": outcome, "audit": entry}
