import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";

export const metadata: Metadata = {
  title: "系统需求文档 PRD｜BRAIN / 27",
  description: "2027 脑科学与 AI 机会雷达的产品目标、功能范围、业务规则和验收标准。",
};

export default function PrdPage() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link href="/system">系统说明</Link><Link className={styles.active} href="/prd">需求文档</Link></div></nav>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>PRODUCT REQUIREMENTS / V0.3</p><h1>自动更新<span>需求文档</span></h1><p className={styles.lede}>把人工整理的职业机会快照升级为可追溯的信息系统：自动检查可信来源、记录变化、保护最后可信内容，并逐步实现字段抽取、新来源发现与人工审核。</p></div>
      <aside className={styles.heroAside}><strong>2026.08.01</strong><p>文档状态：P0 已上线；P1 内容抽取与来源发现待开发；P2 审核后台、通知与模型辅助待开发。</p></aside>
    </header>

    <div className={styles.content}>
      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>背景与目标</h2><p>目标用户是 2027 年毕业、希望从实验心理学进入脑科学、脑机接口或 AI 交叉方向的硕士生。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>当前问题</h3><p>机会、机构、截止日期与建议最初写在前端代码中。来源变化后不会主动发现，也无法回答何时检查、为何变化、是否仍可信。</p></article>
          <article className={styles.requirement}><h3>产品目标</h3><p>建设一条可审计的机会情报管线：定期检查官方来源，保留历史证据，在失败时不丢失可信数据，并让高风险变化进入人工审核。</p></article>
          <article className={styles.requirement}><h3>核心原则</h3><p>官方来源优先、监控与发布分离、失败不删除、全程 UTC 留痕、敏感信息不入日志、所有重要变化可追溯。</p></article>
          <article className={styles.requirement}><h3>非目标</h3><p>不绕过登录、验证码或付费墙；不承诺解析任意网站；当前阶段不允许模型未经审核发布职业判断。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>用户故事</h2><p>系统同时服务求职者和维护者，前者关心可信与及时，后者关心可追溯与可恢复。</p></div>
        <ul className={styles.checklist}>
          <li><span>01</span><div>作为求职者，我希望看到每条机会的原始来源和最后验证时间。</div><span className={styles.tag}>用户</span></li>
          <li><span>02</span><div>作为求职者，我希望失效、截止或发生重大变化的机会被明确标记，而不是无声消失。</div><span className={styles.tag}>用户</span></li>
          <li><span>03</span><div>作为维护者，我希望看到每次巡检检查数、变化数、失败数和来源级状态。</div><span className={styles.tag}>维护者</span></li>
          <li><span>04</span><div>作为维护者，我希望新域名只能先成为候选来源，批准后才进入正式巡检。</div><span className={styles.tag}>维护者</span></li>
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>版本范围</h2><p>“自动更新”分三个阶段交付。P0 解决可靠监控，P1 解决结构化内容更新，P2 解决运营闭环。</p></div>
        <div className={styles.cardGrid}>
          <article className={`${styles.card} ${styles.cardDone}`}><span className={styles.cardLabel}>P0 · 已上线</span><h3>可靠监控与动态展示</h3><p>D1 数据模型、每日 Cron、15 个来源巡检、条件请求、哈希快照、运行记录、审核队列、动态 API 和静态降级。</p></article>
          <article className={`${styles.card} ${styles.cardNext}`}><span className={styles.cardLabel}>P1 · 待开发</span><h3>列表发现与字段抽取</h3><p>按域名适配招聘/招生列表，发现候选详情页，抽取标题、地点、类别、截止日期与正文证据，并处理重复和冲突。</p></article>
          <article className={`${styles.card} ${styles.cardNext}`}><span className={styles.cardLabel}>P2 · 待开发</span><h3>审核后台与模型辅助</h3><p>批准、驳回、编辑变更；生成匹配度和行动建议草案；发送变更通知及每周摘要。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>功能需求</h2><p>需求编号用于开发、测试和发布记录之间的追踪。</p></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ID</th><th>需求</th><th>验收方式</th><th>状态</th></tr></thead><tbody>
          <tr><td>FR-01</td><td>D1 保存来源、机会、机构、快照、运行和审核项。</td><td>远程库迁移完成且种子数量符合预期。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-02</td><td>每日自动检查启用来源，支持超时、有限并发和有限正文。</td><td>scheduled 处理器产生 sync_runs 及来源结果。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-03</td><td>跟踪状态码、最终 URL、ETag、Last-Modified、正文哈希和失败次数。</td><td>来源成功、304、变化和三次失败测试通过。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-04</td><td>页面通过 API 展示已发布记录，数据库不可用时降级。</td><td>API 返回数据库数据；故障时首页仍可渲染。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-05</td><td>从列表和详情页抽取结构化字段并生成证据。</td><td>目标站适配器回归样本通过，冲突进入审核。</td><td><span className={styles.pending}>P1</span></td></tr>
          <tr><td>FR-06</td><td>发现候选链接和新来源，人工批准后启用。</td><td>未知域名不会自动发布或直接加入巡检。</td><td><span className={styles.pending}>P1</span></td></tr>
          <tr><td>FR-07</td><td>提供审核工作台、通知和模型建议草案。</td><td>批准、驳回、编辑和审计链完整。</td><td><span className={styles.pending}>P2</span></td></tr>
        </tbody></table></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>业务规则</h2><p>这些规则优先保护信息正确性，而不是追求无人值守发布速度。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>来源优先级</h3><ul><li>官方 API / RSS</li><li>官方列表页</li><li>官方详情页</li><li>经审核的第三方来源</li></ul></article>
          <article className={styles.requirement}><h3>失败处理</h3><ul><li>失败只增加计数，不删除机会</li><li>恢复成功后失败计数归零</li><li>连续三次失败进入审核</li></ul></article>
          <article className={styles.requirement}><h3>变化处理</h3><ul><li>内容哈希变化保存新快照</li><li>重大变化创建审核项</li><li>截止日期、批次和开放状态需规则验证</li></ul></article>
          <article className={styles.requirement}><h3>发布边界</h3><ul><li>页面只返回 published=true</li><li>新域名先候选、后批准</li><li>模型输出只能作为草案</li></ul></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>非功能需求</h2><p>自动化只有在可观察、安全、可恢复的前提下才算完成。</p></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>维度</th><th>要求</th><th>当前实现</th></tr></thead><tbody>
          <tr><td>可靠性</td><td>单来源失败不终止整批；已发布内容不因抓取失败消失。</td><td>批次隔离、静态降级、最后可信内容保留。</td></tr>
          <tr><td>可观察性</td><td>运行、来源检查、失败和变化均可查询。</td><td>结构化 JSON 日志 + D1 sync_runs。</td></tr>
          <tr><td>安全</td><td>不记录凭据、完整个人信息或任意网页正文。</td><td>日志限字段；快照正文截断为 1,500 字符。</td></tr>
          <tr><td>性能</td><td>限制并发、请求时间和响应体，避免单站拖垮 Worker。</td><td>4 路并发、12 秒超时、512 KiB 上限。</td></tr>
          <tr><td>可恢复</td><td>应用回滚不删除数据；Cron 可独立停用。</td><td>D1 与 Worker 版本分离，配置可移除 Cron。</td></tr>
        </tbody></table></div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>成功指标与验收</h2><p>P0 的验收重在运行可靠；P1/P2 上线后再衡量内容更新速度和审核效率。</p></div>
        <ul className={styles.checklist}>
          <li><span>01</span><div><strong>巡检成功率 ≥ 95%</strong><br /><small>按 7 天滚动窗口统计已启用来源的检查结果。</small></div><span className={`${styles.tag} ${styles.tagPending}`}>待积累数据</span></li>
          <li><span>02</span><div><strong>公开机会具备来源与最后验证时间</strong><br /><small>首次成功巡检后逐条写入 source_verified_at。</small></div><span className={styles.tag}>已实现</span></li>
          <li><span>03</span><div><strong>失败不导致公开内容消失</strong><br /><small>API 与前端故障降级测试、来源失败测试均需持续通过。</small></div><span className={styles.tag}>已实现</span></li>
          <li><span>04</span><div><strong>所有变化可追溯</strong><br /><small>来源快照、运行 ID、内容哈希和审核项形成证据链。</small></div><span className={styles.tag}>已实现</span></li>
        </ul>
      </section>
    </div>
    <footer className={styles.footer}><span>BRAIN / 27 · PRD v0.3</span><p>产品边界：自动发现变化，不未经审核自动发布高风险判断。</p></footer>
  </main>;
}
