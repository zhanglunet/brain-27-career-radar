import type { Metadata } from "next";
import Link from "next/link";
import styles from "../documentation.module.css";

export const metadata: Metadata = {
  title: "系统需求文档 PRD｜BRAIN / 27",
  description: "2027 脑科学与 AI 机会雷达的产品目标、功能范围、业务规则和验收标准。",
};

export default function PrdPage() {
  return <main className={styles.page}>
    <nav className={styles.nav}><Link className={styles.brand} href="/"><span className={styles.brandMark}>Ψ</span> BRAIN / 27</Link><div className={styles.navLinks}><Link href="/">机会雷达</Link><Link href="/sources">信息源</Link><Link href="/logs">采集日志</Link><Link href="/system">系统说明</Link><Link className={styles.active} href="/prd">需求文档</Link></div></nav>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>PRODUCT REQUIREMENTS / V0.7</p><h1>自动更新<span>需求文档</span></h1><p className={styles.lede}>自动检查可信来源、记录变化、保护最后可信内容；同时提供硕士可申请的高校科研助理路径，并保证电脑和手机都能完整使用。</p></div>
      <aside className={styles.heroAside}><strong>2026.08.01</strong><p>P1.9 科研助理路径、上海深圳重点覆盖和响应式页面已实现；高风险语义字段仍不自动发布。</p></aside>
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
          <article className={`${styles.card} ${styles.cardDone}`}><span className={styles.cardLabel}>P0 · 已上线</span><h3>可靠监控与动态展示</h3><p>D1 数据模型、分频 Cron、51 个自动来源巡检、逐来源日志、条件请求、哈希快照、审核队列、动态 API 和静态降级。</p></article>
          <article className={`${styles.card} ${styles.cardDone}`}><span className={styles.cardLabel}>P1 · 灰度观察</span><h3>列表发现与字段抽取</h3><p>5 个来源已启用适配器，候选与证据进入 D1；待完成 7 天准确率、重复率和安全边界验收。</p></article>
          <article className={`${styles.card} ${styles.cardNext}`}><span className={styles.cardLabel}>P2 · 待开发</span><h3>审核后台与模型辅助</h3><p>批准、驳回、编辑变更；生成匹配度和行动建议草案；发送变更通知及每周摘要。</p></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>P1 开发路径</h2><p>P1 的目标不是让模型自由改页面，而是把来源页面转换成带证据、可比较、可审核的结构化候选变更。</p></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>阶段</th><th>开发内容</th><th>主要产物</th><th>完成标准</th></tr></thead><tbody>
          <tr><td>P1.1</td><td>扩展数据模型，区分抓取结果、候选记录、字段证据和待发布变更。</td><td>candidate_records、field_evidence、change_sets 迁移与类型。</td><td>迁移可回滚；旧机会和历史快照不丢失。</td></tr>
          <tr><td>P1.2</td><td>建立来源适配器框架，为列表页、详情页、API/RSS 提供统一接口。</td><td>Adapter SDK、站点配置、抓取夹具和错误分类。</td><td>新增站点无需修改巡检主循环。</td></tr>
          <tr><td>P1.3</td><td>发现候选链接，进行 URL 规范化、重定向归一、跨列表去重和新域名隔离。</td><td>Link Discovery、去重键、候选来源队列。</td><td>重复链接不重复建档；未知域名不自动启用。</td></tr>
          <tr><td>P1.4</td><td>抽取标题、机构、类型、地点、批次、截止日期、开放状态和正文证据。</td><td>字段解析器、JSON-LD/DOM/规则回退、证据片段。</td><td>每个字段都能追溯到来源 URL、快照和文本证据。</td></tr>
          <tr><td>P1.5</td><td>比较候选与已发布记录，执行日期校验、冲突检测、风险分级和审核路由。</td><td>Change Set、风险规则、parse_conflict 审核项。</td><td>高风险字段不自动发布；低风险变更可配置自动合并。</td></tr>
          <tr><td>P1.6</td><td>小范围上线、回放测试、指标监控和分批扩展来源。</td><td>5 个试点适配器、回归样本、7 天观察报告。</td><td>抽取准确率 ≥ 95%，重复率 &lt; 1%，无未经审核的高风险发布。</td></tr>
          <tr><td>P1.7</td><td>建立可检索的信息源目录和逐来源历史日志，扩展博士与校招重点地区。</td><td>来源/日志 API、两个公开查询页面。</td><td>英国、爱尔兰、中国大陆、中国香港均可筛选；每次 Cron 留下逐来源结果。</td></tr>
          <tr><td>P1.8</td><td>自动审查页面变化，按来源优先级和检查间隔调度。</td><td>自动观察/稳定结案、47 个来源、14 个重点来源。</td><td>重点每 6 小时、普通每日；语义变化不自动发布。</td></tr>
          <tr><td>P1.9</td><td>增加硕士可申请的高校科研助理路径，并强化香港、上海、深圳覆盖。</td><td>57 个来源、31 个重点来源、9 个科研助理入口/岗位及响应式卡片。</td><td>学历和博士过渡价值清晰；电脑与手机均可筛选和阅读。</td></tr>
        </tbody></table></div>
        <p className={styles.note}>结构化抽取先覆盖 5 个来源并观察一周；57 个来源已进入目录，其中 51 个执行基础巡检。达到准确率与重复率门槛后，再按页面稳定性分批开发更多字段适配器。</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>P1 功能清单</h2><p>交付完成后，系统才能从“发现页面变化”升级为“生成可审核的内容更新”。</p></div>
        <div className={styles.requirements}>
          <article className={styles.requirement}><h3>适配器与发现</h3><ul><li>列表、详情、API/RSS 统一接口</li><li>分页与候选链接发现</li><li>URL 归一和跨来源去重</li></ul></article>
          <article className={styles.requirement}><h3>结构化抽取</h3><ul><li>机会核心字段与原文证据</li><li>日期、地点和状态规范化</li><li>解析失败与冲突留痕</li></ul></article>
          <article className={styles.requirement}><h3>安全更新</h3><ul><li>字段级差异与风险分类</li><li>低风险字段受控自动合并</li><li>截止日期等高风险字段审核</li></ul></article>
          <article className={styles.requirement}><h3>质量与运维</h3><ul><li>固定网页样本回放测试</li><li>抽取准确率和重复率指标</li><li>适配器失效告警与回滚</li></ul></article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}><h2>功能需求</h2><p>需求编号用于开发、测试和发布记录之间的追踪。</p></div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>ID</th><th>需求</th><th>验收方式</th><th>状态</th></tr></thead><tbody>
          <tr><td>FR-01</td><td>D1 保存来源、机会、机构、快照、运行和审核项。</td><td>远程库迁移完成且种子数量符合预期。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-02</td><td>按来源间隔自动检查启用来源，支持超时、有限并发和有限正文。</td><td>scheduled 处理器产生 sync_runs 及来源结果。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-03</td><td>跟踪状态码、最终 URL、ETag、Last-Modified、正文哈希和失败次数。</td><td>来源成功、304、变化和三次失败测试通过。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-04</td><td>页面通过 API 展示已发布记录，数据库不可用时降级。</td><td>API 返回数据库数据；故障时首页仍可渲染。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-05</td><td>从列表和详情页抽取结构化字段并生成证据。</td><td>目标站适配器回归样本通过，冲突进入审核。</td><td><span className={styles.good}>已灰度</span></td></tr>
          <tr><td>FR-06</td><td>发现候选链接和新来源，人工批准后启用。</td><td>同站候选已灰度；未知域名不会自动发布或直接加入巡检。</td><td><span className={styles.pending}>部分完成</span></td></tr>
          <tr><td>FR-07</td><td>提供审核工作台、通知和模型建议草案。</td><td>批准、驳回、编辑和审计链完整。</td><td><span className={styles.pending}>P2</span></td></tr>
          <tr><td>FR-08</td><td>公开信息源清单，可按关键词、博士/科研助理/校招、地区、优先级和采集状态筛选。</td><td>目录返回 57 个来源；覆盖英国、爱尔兰、中国大陆和中国香港。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-09</td><td>公开可检索的历史运行与逐来源采集日志。</td><td>按来源、结果、类型、地区和 UTC 日期检索；显示候选、证据、决策和发布计数。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-10</td><td>页面哈希变化自动观察，下一轮稳定后自动结案；新增机会和字段冲突人工审核。</td><td>日志页显示 review_mode、状态和结论；自动结案不修改公开语义字段。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-11</td><td>牛津、剑桥、UCL、清华、北大等重点来源每 6 小时检查。</td><td>调度按 priority 与 check_interval_hours 只选择到期来源。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-12</td><td>博士与联培博士明确标注全奖、部分资助、混合、自费或待确认。</td><td>页面显示 funding_type、覆盖范围和官方核验说明；国际生学费差额单独提示。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-13</td><td>科研助理独立展示硕士资格、逐岗学历条件和博士过渡价值。</td><td>9 个入口/岗位均显示字段；文案不暗示工作可自动转博。</td><td><span className={styles.good}>已完成</span></td></tr>
          <tr><td>FR-14</td><td>首页、来源、日志、系统和 PRD 页面适配电脑与手机。</td><td>桌面多列、手机单列；筛选可横向滚动，关键字段不隐藏。</td><td><span className={styles.good}>已完成</span></td></tr>
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
    <footer className={styles.footer}><span>BRAIN / 27 · PRD v0.7</span><p>产品边界：自动发现变化，不未经审核自动发布高风险判断。</p></footer>
  </main>;
}
