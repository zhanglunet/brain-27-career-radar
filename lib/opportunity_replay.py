# -*- coding: utf-8 -*-
"""PRD-351/T2（trend issue #1630 的 T2 环节）：机会评估重放包最小实现。

按 T1 设计（docs/plans/2026-11-11-prd-351-opportunity-replay-design.md）
§3.1/§3.2/§4 实现：

  - make_pack(evaluations, snapshots, *, rules_version)：从机会评估决策记录
    构建重放包（R1 三件套）——input_fingerprint（机会快照 digest + 评分规则
    版本）、decisions（评分与权重与理由逐条）、output（推荐结论与复核状态
    汇总）；缺任一 PACK_INCOMPLETE；
  - replay(pack, snapshots, eval_fn, *, rules_version)：重放三步（§3.2）——
    ①指纹复核（机会快照 digest 或规则版本不符 → REPLAY_INPUT_DRIFT 拒绝）
    ②注入式 eval_fn 深拷贝复算评估层（纯判定，投递零触发 R2）③decisions
    逐字节比对 → REPLAY_OK / REPLAY_MISMATCH（首分歧条显形，R3 零静默换新
    推荐）；
  - ReplayLedger：append-only（R4）；
  - **投递零自动**（R2）：本模块零投递触发（T4 AST 预埋：零投递导入，
    与 PRD-337/T4 同表）——投递动作仍走 PRD-175 批准门。

零网络；示例全虚构占位。
测试：tests/test_prd351_t2_opportunity_replay.py
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Callable

PACK_SCHEMA = "opportunity-replay-pack/v1"
ERROR_CODES = ("REPLAY_INPUT_DRIFT", "REPLAY_MISMATCH", "PACK_INCOMPLETE")
_DECISION_KEYS = ("opportunity_id", "score", "why")


def _digest(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                           separators=(",", ":"))
    return "sha16:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def snapshot_digest(snapshots: list[dict[str, Any]]) -> str:
    return _digest(snapshots)


def make_pack(evaluations: list[dict[str, Any]],
              snapshots: list[dict[str, Any]], *,
              rules_version: str) -> dict[str, Any]:
    """从评估决策记录构建重放包（R1 三件套）。"""
    clean = []
    for e in evaluations or []:
        if not all(e.get(k) is not None for k in _DECISION_KEYS):
            return {"schema": PACK_SCHEMA, "refused": "PACK_INCOMPLETE",
                    "detail": f"评估缺 {_DECISION_KEYS} 任一——拒绝入账"}
        clean.append({k: e.get(k) for k in
                      ("opportunity_id", "score", "weights", "why")})
    if not clean or not snapshots or not rules_version:
        return {"schema": PACK_SCHEMA, "refused": "PACK_INCOMPLETE",
                "detail": "evaluations/snapshots/rules_version 缺失"}
    return {
        "schema": PACK_SCHEMA,
        "input_fingerprint": {"snapshot_digest": snapshot_digest(snapshots),
                              "rules_version": rules_version},
        "decisions": clean,
        "output": {"recommendations": [
            "recommend" if c["score"] >= 70 else "hold" for c in clean],
            "review_states": ["pending"] * len(clean)},
    }


def _refusal(code: str, detail: str) -> dict[str, Any]:
    return {"schema": PACK_SCHEMA, "refused": code, "detail": detail,
            "verdict": None}


def replay(pack: dict[str, Any], snapshots: list[dict[str, Any]],
           eval_fn: Callable[[list], list[dict[str, Any]]], *,
           rules_version: str) -> dict[str, Any]:
    """重放三步（§3.2）：评估层复算（R2 投递零触发），对不上显形（R3）。"""
    fp = pack.get("input_fingerprint") or {}
    if (not fp or pack.get("refused") or not pack.get("decisions")
            or not pack.get("output")):
        return _refusal("PACK_INCOMPLETE", "重放包三件套不齐")
    if (snapshot_digest(snapshots) != fp.get("snapshot_digest")
            or rules_version != fp.get("rules_version")):
        return _refusal("REPLAY_INPUT_DRIFT",
                        "机会快照指纹或规则版本与包不符——拒绝重放"
                        "（防新快照冒充当时）")
    rerun = eval_fn(copy.deepcopy(snapshots)) or []
    norm = [{k: e.get(k) for k in ("opportunity_id", "score", "weights",
                                   "why")} for e in rerun]
    for i, want in enumerate(pack["decisions"]):
        got = norm[i] if i < len(norm) else None
        if got != want:
            return {"schema": PACK_SCHEMA, "refused": None,
                    "verdict": "REPLAY_MISMATCH",
                    "evidence": {"first_divergence_index": i,
                                 "want": want, "got": got},
                    "rerun_count": len(norm)}
    if len(norm) != len(pack["decisions"]):
        return {"schema": PACK_SCHEMA, "refused": None,
                "verdict": "REPLAY_MISMATCH",
                "evidence": {"first_divergence_index": len(norm),
                             "why": "决策条数不一致"},
                "rerun_count": len(norm)}
    return {"schema": PACK_SCHEMA, "refused": None, "verdict": "REPLAY_OK",
            "evidence": None, "rerun_count": len(norm)}


class ReplayLedger:
    """重放账本（R4）：append-only 只增不删。"""

    def __init__(self) -> None:
        self._entries: list[dict[str, Any]] = []

    def record(self, pack: dict[str, Any], verdict: dict[str, Any], *,
               at: str) -> dict[str, Any]:
        entry = {"at": at,
                 "pack_fingerprint": copy.deepcopy(pack.get("input_fingerprint")),
                 "verdict": verdict.get("verdict") or verdict.get("refused"),
                 "evidence": copy.deepcopy(verdict.get("evidence"))}
        self._entries.append(entry)
        return dict(entry)

    @property
    def entries(self) -> list[dict[str, Any]]:
        return [dict(e) for e in self._entries]
