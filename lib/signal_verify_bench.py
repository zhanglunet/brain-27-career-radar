# -*- coding: utf-8 -*-
"""PRD-379/T2（trend issue #1883 的 T2 环节）：机会信号验证台最小实现。

按 T1 设计（docs/plans/2026-11-12-prd-379-signal-verification-bench-design.md）
§4 落地：

  - verify_signal(signal, corpus, recheck_fn)：逐条信号来源复核验证
    ——recheck_fn 注入式重跑同一来源复核判定（语料快照只读深拷贝，零
    新增判定逻辑 R2，复访=对既有语料快照复算零真实外呼）；来源在语料中
    可复访（source_match）+ quote 逐字回指（quote_match）双 match →
    VERIFIED，否则 UNVERIFIED（词表封闭）；语料指纹 sha16: 前缀确定性
    （与 351 snapshot_digest 同族口径）；
  - verify_signals(signals, corpus, recheck_fn)：机会库入库来源包装
    （接入点：aggregate 信号之后、机会库与 approval_inbox.collect
    (delivery_pending) 之前）——UNVERIFIED 拦下不进机会库（R1）；
  - SignalBenchLedger：机器可读 JSONL 落账（路径注入，append-only R3/R4）；
    八件套缺一 BENCH_INCOMPLETE 拒绝入账；
  - reverify：语料变更二次验证——指纹不符 → BENCH_STALE 拒绝复用旧验证
    （R4 关闭以最新 VERIFIED 为准）。

零网络零子进程零投递词面（复访=对语料快照复算，反爬拒绝显形零伪装红线
不变）；示例 URL 一律 example.invalid；示例全虚构占位。
测试：tests/test_prd379_t2_signal_verify_bench.py
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Callable

BENCH_SCHEMA = "signal-verify-bench/v1"
VERDICTS = ("VERIFIED", "UNVERIFIED")
ERROR_CODES = ("BENCH_INCOMPLETE", "BENCH_REPRO_MISMATCH", "BENCH_STALE")


class SignalBenchError(ValueError):
    """验证台违规——显形拒绝。"""


def corpus_fingerprint(corpus: Any) -> str:
    """语料快照指纹（sha16: 前缀，与 351 snapshot_digest 同族口径）。"""
    canon = json.dumps(corpus, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"))
    return "sha16:" + hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16]


def _recusal(code: str, detail: str) -> dict[str, Any]:
    return {"schema": BENCH_SCHEMA, "refused": code, "detail": detail,
            "verdict": None}


def _source_match(signal: dict[str, Any], rerun: list[dict[str, Any]],
                  corpus: Any) -> bool:
    """来源复核：重跑结果中存在同 source_url 信号，且该 URL 在语料快照中
    可复访（语料条目含该 URL）。"""
    url = signal.get("source_url")
    in_corpus = any(str(c.get("url") or "") == str(url)
                    for c in (corpus or []))
    hit = any(str(r.get("source_url")) == str(url) for r in rerun)
    return bool(in_corpus and hit)


def verify_signal(signal: dict[str, Any], corpus: Any,
                  recheck_fn: Callable[[Any], list[dict[str, Any]]],
                  *, at: str = "") -> dict[str, Any]:
    """逐条信号来源复核验证（R1/R2）：复访+quote 回指双 match。"""
    if not isinstance(signal, dict):
        return _recusal("BENCH_INCOMPLETE", "signal 非对象")
    missing = [k for k in ("signal_id", "source_url", "kind", "source_ref",
                           "quote") if not signal.get(k)]
    if missing:
        return _recusal("BENCH_INCOMPLETE", f"八件套缺 {missing}")
    if not callable(recheck_fn):
        return _recusal("BENCH_INCOMPLETE", "recheck_fn 未注入")
    rerun = recheck_fn(copy.deepcopy(corpus)) or []
    sm = _source_match(signal, rerun, corpus)
    qm = bool(signal["quote"]) and any(
        str(signal["quote"]) in str(c.get("text") or "") for c in (corpus or
                                                                   []))
    ok = sm and qm
    return {
        "schema": BENCH_SCHEMA,
        "signal_id": signal["signal_id"],
        "source_url": signal["source_url"],
        "kind": signal["kind"],
        "source_ref": signal["source_ref"],
        "corpus_fingerprint": corpus_fingerprint(corpus),
        "signal": copy.deepcopy(signal),
        "reproduce": {"source_match": sm, "quote_match": qm,
                      "detail": f"重跑复核 {len(rerun)} 条（占位）"},
        "verdict": "VERIFIED" if ok else "UNVERIFIED",
        "at": at,
    }


def verify_signals(signals: list[dict[str, Any]], corpus: Any,
                   recheck_fn: Callable[[Any], list[dict[str, Any]]],
                   *, at: str = "") -> dict[str, Any]:
    """机会库入库来源包装（接入点）：UNVERIFIED 拦下不进机会库（R1）。"""
    verified: list[dict[str, Any]] = []
    unverified: list[dict[str, Any]] = []
    for s in signals or []:
        out = verify_signal(s, corpus, recheck_fn, at=at)
        if out.get("refused") or out["verdict"] == "UNVERIFIED":
            unverified.append(out)
        else:
            verified.append(out)
    return {"schema": BENCH_SCHEMA, "verified": verified,
            "unverified": unverified, "unverified_count": len(unverified)}


class SignalBenchLedger:
    """验证账本（R3/R4）：JSONL append-only；八件套缺一拒绝入账。"""

    _REQUIRED = ("signal_id", "source_url", "kind", "source_ref",
                 "corpus_fingerprint", "signal", "verdict")

    def __init__(self, path: str | Path | None = None) -> None:
        self._records: list[dict[str, Any]] = []
        self._path = Path(path) if path else None

    def record(self, out: dict[str, Any], *, at: str = "") -> dict[str, Any]:
        if out.get("refused"):
            raise SignalBenchError(f"{out['refused']}：{out['detail']}")
        rec = dict(out, at=at)
        missing = [k for k in self._REQUIRED if rec.get(k) in (None, "")]
        if missing:
            raise SignalBenchError(f"BENCH_INCOMPLETE：账目缺 {missing}")
        if rec["verdict"] not in VERDICTS:
            raise SignalBenchError(f"BENCH_INCOMPLETE：verdict 词表外 "
                                   f"{rec['verdict']!r}")
        rep = rec["reproduce"]
        if rec["verdict"] == "VERIFIED" and not (rep.get("source_match")
                                                 and rep.get("quote_match")):
            raise SignalBenchError("BENCH_REPRO_MISMATCH：声称 VERIFIED 但"
                                   "复现不全——验证结论与复现证据不一致")
        self._records.append(copy.deepcopy(rec))
        if self._path is not None:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, ensure_ascii=False,
                                    sort_keys=True) + "\n")
        return dict(rec)

    def entries(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._records]

    def latest_for(self, signal_id: str) -> dict[str, Any] | None:
        found = [r for r in self._records if r["signal_id"] == signal_id]
        return dict(found[-1]) if found else None

    def reverify(self, signal_id: str, corpus: Any,
                 recheck_fn: Callable[[Any], list[dict[str, Any]]],
                 *, at: str = "") -> dict[str, Any]:
        """语料变更二次验证（R4）：指纹不符 → BENCH_STALE 拒绝复用。"""
        prior = self.latest_for(signal_id)
        fp_now = corpus_fingerprint(corpus)
        if prior and prior["corpus_fingerprint"] != fp_now:
            return _recusal("BENCH_STALE",
                            f"{signal_id} 旧验证语料指纹与当前不符——语料变更"
                            "后须重新验证，旧 VERIFIED 不复用")
        base = {"signal_id": signal_id,
                "source_url": (prior or {}).get("source_url") or "",
                "kind": (prior or {}).get("kind") or "",
                "source_ref": (prior or {}).get("source_ref") or "",
                "quote": ((prior or {}).get("signal") or {}).get("quote")}
        return self.record(verify_signal(base, corpus, recheck_fn, at=at),
                           at=at)
