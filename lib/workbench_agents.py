#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PRD-232/T3：多 agent 协作接入——搜集/准备/复盘分工（trend issue #1162）。

按 T1 设计（docs/plans/2026-10-26-job-workbench-design.md）§三实现，叠加
T2 TaskQueue（lib/task_queue.py，队列状态机不动）：

  §3.1 三类 agent 职责边界（能力白名单，越权即断）：
    - collector 搜集：提议入队/写候选缓存/读机会通道——不直接入队、不写草稿；
    - preparer 准备：写 materials 草稿（带 AI 标注）——不发投递、不碰批准门；
    - reviewer 复盘：写复盘报告/提议状态迁移（迁移由用户确认触发）。
    总红线（§3.4）：任何 agent 都无权直接投递，也无权调用批准门任何接口
    （连 requestApproval 都不行）；能力表外的动作 → agent_boundary_violation
    事件 + 任务立即终止（§3.3，T4 门禁测试固化为 G3 用例）。
  §3.2 任务对象：{task_id, agent_kind, item_id, input_refs, output_refs, status,
    created_at, finished_at, failure_summary}；status 五态
    queued/running/done/failed/abandoned。
    分配：工作台是唯一调度者；**agent 之间不得互相派活**——agent 只能在产出里
    写「建议任务」（suggest_task），由用户决定是否建单。
    回收：**产出落盘才算完成**——complete 校验每个 output_ref 的路径真实存在
    且引用合法，校验不过 = failed（写 failure_summary）。
  §3.3 失败处理：任务失败不自动重试（新任务新 task_id，不复活旧任务）；
    同一 agent_kind 连续失败 3 次 → 标 degraded，自动派发停止（手动派发仍可）；
    running 任务可被用户随时终止（abandoned，留痕）。

零网络；产出存在性由调用方注入的 fs 探针校验（默认 os.path.exists）；
now 全部注入；示例中公司/岗位/路径全为占位。
测试：tests/test_prd232_t3_agents.py
"""
from __future__ import annotations

import os
from typing import Any, Callable

AGENT_KINDS = ("collector", "preparer", "reviewer")
TASK_STATUSES = ("queued", "running", "done", "failed", "abandoned")
#: §3.4 能力白名单（表外一律越权；requestApproval/execute 对全员封闭）
AGENT_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "collector": ("read_opportunity_channel", "propose_enqueue", "write_candidate_cache"),
    "preparer": ("write_materials_draft",),
    "reviewer": ("write_review_report", "propose_transition"),
}
FORBIDDEN_FOR_ALL = ("request_approval", "execute_delivery", "transition_status",
                     "dispatch_task", "write_matcher_config")
#: §3.3 同一 agent 连续失败阈值（T3 定：默认建议 3 次）
DEGRADED_THRESHOLD = 3
OUTPUT_REF_KINDS = ("materials", "report", "candidate_cache", "interview_kit")


class AgentBoardError(ValueError):
    """协作板输入/流转违规。"""


class BoundaryViolation(AgentBoardError):
    """agent 越权（能力表外动作）——任务终止 + agent_boundary_violation 事件。"""


class AgentTaskBoard:
    """协作任务板：工作台是唯一调度者，agent 只执行不派活。"""

    def __init__(self, *, exists_fn: Callable[[str], bool] | None = None) -> None:
        self.tasks: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []  # append-only（§5.2 留痕）
        self.suggestions: list[dict[str, Any]] = []  # agent「建议任务」待用户决定
        self.degraded: dict[str, bool] = {k: False for k in AGENT_KINDS}
        self._failure_streaks: dict[str, int] = {k: 0 for k in AGENT_KINDS}
        self._exists = exists_fn or os.path.exists

    # ---------------------------------------------------------------- 内部

    def _task(self, task_id: str) -> dict[str, Any]:
        task = self.tasks.get(task_id)
        if not task:
            raise AgentBoardError(f"任务不存在：{task_id!r}")
        return task

    def _event(self, type_: str, task_id: str, at: str, **payload: Any) -> None:
        self.events.append({"type": type_, "task_id": task_id, "at": at, **payload})

    # ---------------------------------------------------------------- 建单/派发

    def create_task(self, task_id: str, agent_kind: str, item_id: str, *,
                    input_refs: list[dict[str, str]] | None = None,
                    at: str = "", manual: bool = True) -> dict[str, Any]:
        """建单（工作台唯一调度入口；agent_kind 非法/重复 id 拒绝）。

        degraded 状态下自动建单拒绝（manual=False），手动建单仍可（§3.3）。
        """
        if agent_kind not in AGENT_KINDS:
            raise AgentBoardError(f"agent_kind 非法：{agent_kind!r}（{AGENT_KINDS}）")
        if task_id in self.tasks:
            raise AgentBoardError(f"任务已存在（不复活旧任务，重试须新建 task_id）：{task_id!r}")
        if self.degraded[agent_kind] and not manual:
            raise AgentBoardError(f"{agent_kind} 已 degraded：自动派发停止，请人工处理（§3.3）")
        task = {
            "task_id": task_id, "agent_kind": agent_kind, "item_id": item_id,
            "input_refs": list(input_refs or []),
            "output_refs": [],
            "status": "queued",
            "created_at": at, "finished_at": None, "failure_summary": None,
        }
        self.tasks[task_id] = task
        self._event("task_created", task_id, at, agent_kind=agent_kind,
                    item_id=item_id, manual=manual)
        return dict(task)

    def suggest_task(self, agent_kind: str, item_id: str, description: str,
                     *, at: str = "") -> dict[str, Any]:
        """agent 发现后续工作只能写「建议任务」，由工作台呈现给用户决定（§3.2）。"""
        if agent_kind not in AGENT_KINDS:
            raise AgentBoardError(f"agent_kind 非法：{agent_kind!r}")
        suggestion = {"agent_kind": agent_kind, "item_id": item_id,
                      "description": description, "at": at,
                      "status": "pending_user_decision"}
        self.suggestions.append(suggestion)
        self._event("task_suggested", f"{agent_kind}:{item_id}", at, description=description)
        return dict(suggestion)

    def dispatch(self, task_id: str, *, at: str = "", manual: bool = False) -> dict[str, Any]:
        """派发：queued → running；degraded 自动派发拒绝、手动放行（§3.3）。"""
        task = self._task(task_id)
        if task["status"] != "queued":
            raise AgentBoardError(f"状态 {task['status']} 不可派发（仅 queued）")
        if self.degraded[task["agent_kind"]] and not manual:
            raise AgentBoardError(f"{task['agent_kind']} 已 degraded：自动派发停止（§3.3）")
        task["status"] = "running"
        self._event("task_dispatched", task_id, at, manual=manual)
        return dict(task)

    # ---------------------------------------------------------------- 执行面（agent 视角）

    def enforce_capability(self, agent_kind: str, action: str) -> None:
        """能力校验：表外动作即 BoundaryViolation（调用方据此终止任务，§3.3）。"""
        if agent_kind not in AGENT_KINDS:
            raise AgentBoardError(f"agent_kind 非法：{agent_kind!r}")
        if action in FORBIDDEN_FOR_ALL or action not in AGENT_CAPABILITIES[agent_kind]:
            raise BoundaryViolation(
                f"{agent_kind} 无权执行 {action!r}（§3.4 能力边界表外——"
                "agent 与投递之间永远隔着两道人工动作）")

    def record_boundary_violation(self, task_id: str, action: str, *, at: str = "") -> dict[str, Any]:
        """越权处置：立即终止任务（failed）+ agent_boundary_violation 事件（§3.3）。"""
        task = self._task(task_id)
        if task["status"] not in ("queued", "running"):
            raise AgentBoardError(f"状态 {task['status']} 无需越权终止")
        task["status"] = "failed"
        task["finished_at"] = at
        task["failure_summary"] = f"越权动作被拦截：{action!r}（agent_boundary_violation）"
        self._event("agent_boundary_violation", task_id, at, action=action,
                    agent_kind=task["agent_kind"])
        return dict(task)

    def complete_task(self, task_id: str, output_refs: list[dict[str, str]], *,
                      at: str = "") -> dict[str, Any]:
        """回收（§3.2）：产出落盘才算完成——逐个 output_ref 校验落盘与引用合法。"""
        task = self._task(task_id)
        if task["status"] != "running":
            raise AgentBoardError(f"状态 {task['status']} 不可回收（仅 running）")
        problems: list[str] = []
        for ref in output_refs or []:
            if ref.get("kind") not in OUTPUT_REF_KINDS:
                problems.append(f"引用 kind 非法：{ref.get('kind')!r}")
            path = ref.get("path", "")
            if not path or not self._exists(path):
                problems.append(f"产出未落盘或路径不存在：{path!r}")
        if problems:
            return self.fail_task(task_id, "产出校验失败：" + "；".join(problems), at=at)
        task["status"] = "done"
        task["output_refs"] = list(output_refs)
        task["finished_at"] = at
        self._failure_streaks[task["agent_kind"]] = 0  # 成功清零连败计数
        self._event("task_done", task_id, at, output_count=len(output_refs))
        return dict(task)

    # ---------------------------------------------------------------- 失败/终止

    def fail_task(self, task_id: str, summary: str, *, at: str = "") -> dict[str, Any]:
        """失败处置（§3.3）：置 failed + 摘要（不含材料正文）；条目状态不变、
        不自动重试；连败计数累计，达 3 次该 agent_kind 标 degraded。"""
        task = self._task(task_id)
        if task["status"] not in ("queued", "running"):
            raise AgentBoardError(f"状态 {task['status']} 不可置失败")
        task["status"] = "failed"
        task["finished_at"] = at
        task["failure_summary"] = summary
        kind = task["agent_kind"]
        self._failure_streaks[kind] += 1
        if self._failure_streaks[kind] >= DEGRADED_THRESHOLD and not self.degraded[kind]:
            self.degraded[kind] = True
            self._event("agent_degraded", task_id, at, agent_kind=kind,
                        consecutive_failures=self._failure_streaks[kind])
        self._event("task_failed", task_id, at, summary=summary)
        return dict(task)

    def abandon_task(self, task_id: str, *, at: str = "", by: str = "user") -> dict[str, Any]:
        """用户随时终止 running 任务（§3.2 呈现/终止），留痕。"""
        task = self._task(task_id)
        if task["status"] != "running":
            raise AgentBoardError(f"状态 {task['status']} 不可终止（仅 running）")
        task["status"] = "abandoned"
        task["finished_at"] = at
        self._event("task_abandoned", task_id, at, by=by)
        return dict(task)

    def list_tasks(self, agent_kind: str | None = None,
                   status: str | None = None) -> list[dict[str, Any]]:
        """任务呈现（§3.2）：可按 agent_kind/status 过滤，按 task_id 排序。"""
        tasks = [dict(t) for t in self.tasks.values()]
        if agent_kind:
            tasks = [t for t in tasks if t["agent_kind"] == agent_kind]
        if status:
            tasks = [t for t in tasks if t["status"] == status]
        return sorted(tasks, key=lambda t: t["task_id"])
