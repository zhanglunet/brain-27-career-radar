# PRD-281/T5 验收试运行记录：求职档案改动草稿+回滚全流程演练 + 红线断言 + 文档无密钥

- 日期：2026-10-30
- trend issue：[zhanglunet/trend#1410](https://github.com/zhanglunet/trend/issues/1410)
- 中央 PRD：`trend/adopted/PRD-281-brain27-profile-draft-rollback.md`
- 全链：T1 #1406（设计 `docs/plans/2026-10-29-prd-281-profile-draft-rollback.md`）→ T2 #1407（`profile-draft.mjs` 草稿/确认/回滚）→ T3 #1408（确认流正式化 `profile-confirm-flow.mjs`）→ T4 #1409（175 门断言 `profile-apply-assertions.mjs`）→ 本任务 T5
- 验收测试：`tests/test_prd281_acceptance.test.mjs`（8 例，NODE_OPTIONS=--experimental-strip-types node --test）
- 状态：验收通过；实现类 PR 只开不合并，等用户 review

## 验收标准逐条核验（issue #1410）

### 1. 求职档案改动可逆（全链通过）— 通过

虚构档案全流程演练：makeDraft（JSON Pointer 改动+指纹）→ confirmFlow（指纹重验+
原子生效+上一版自动保留 prev）→ rollbackToPrev 回到上一版；draftState 三态
draft→confirmed→rolled-back 全程可查；审计事件（confirmer_required/confirm_conflict/
confirmed/rolled_back）可导出。

### 2. 红线断言全过 — 通过

- 175 门不变：assertNoApplyDeps 对业务模块（profile-draft/profile-confirm-flow）全源
  扫描六形态零命中；assertGateReferencePresent 175 门引用行在场
- 指纹冲突拒绝：改动期间文档被外部修改 → confirm_conflict 拒绝合并不静默
- 本地处理：三模块零网络原语（fetch/http/axios/net 零命中）
- 密钥扫描：交付模块零命中

### 3. 文档无密钥 — 通过

交付模块+验收测试扫描零命中。

## 运行记录

`NODE_OPTIONS=--experimental-strip-types node --test tests/test_prd281_acceptance.test.mjs`
→ 8 pass / 0 fail。

## 结论

PRD-281 全链（T1–T5）验收通过；只开不合并，等用户 review。
