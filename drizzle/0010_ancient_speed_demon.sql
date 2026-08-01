CREATE TABLE `paper_provider_sync_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`researchers_checked` integer DEFAULT 0 NOT NULL,
	`candidates_found` integer DEFAULT 0 NOT NULL,
	`papers_inserted` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_summary` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `academic_sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_id`) REFERENCES `paper_providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `paper_provider_sync_run_unique` ON `paper_provider_sync_logs` (`run_id`,`provider_id`);--> statement-breakpoint
CREATE INDEX `paper_provider_sync_provider_idx` ON `paper_provider_sync_logs` (`provider_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `paper_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`homepage_url` text NOT NULL,
	`api_docs_url` text NOT NULL,
	`description` text NOT NULL,
	`coverage` text NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`credential_env` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`discovery_enabled` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`last_sync_at` text,
	`last_sync_status` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `paper_providers_status_idx` ON `paper_providers` (`status`,`priority`);--> statement-breakpoint
CREATE INDEX `paper_providers_enabled_idx` ON `paper_providers` (`enabled`,`discovery_enabled`);
--> statement-breakpoint
INSERT OR IGNORE INTO `paper_providers`
(`id`,`name`,`category`,`homepage_url`,`api_docs_url`,`description`,`coverage`,`auth_mode`,`credential_env`,`status`,`enabled`,`discovery_enabled`,`priority`,`capabilities_json`,`notes`) VALUES
('crossref','Crossref','metadata','https://www.crossref.org/','https://www.crossref.org/documentation/retrieve-metadata/rest-api/','跨学科 DOI 注册与出版元数据，适合发现正式论文并按 DOI 去重。','全球跨学科期刊、会议、专著与预印本元数据','none',NULL,'active',1,1,10,'["论文发现","DOI","出版日期","作者","期刊"]','当前主发现源；作者同名结果只作为候选。'),
('europe_pmc','Europe PMC','biomedical','https://europepmc.org/','https://europepmc.org/RestfulWebService','生命科学与医学文献聚合，覆盖 PubMed、PMC、预印本、摘要、开放获取和状态更新。','全球生命科学、神经科学、医学与相关预印本','none',NULL,'active',1,1,20,'["论文发现","PMID","PMCID","DOI","摘要","开放获取"]','已自动启用；与 Crossref 通过 DOI/PMID 合并。'),
('arxiv','arXiv','preprint','https://arxiv.org/','https://info.arxiv.org/help/api/index.html','物理、计算机、统计、定量生物等预印本，适合 NeuroAI、机器学习和 BCI 算法动态。','全球开放预印本，重点 cs、q-bio、stat、eess','none',NULL,'available',0,0,30,'["预印本","arXiv ID","版本","作者","分类"]','无需密钥；下一适配器，需加强作者消歧和版本合并。'),
('pubmed','PubMed E-utilities','biomedical','https://pubmed.ncbi.nlm.nih.gov/','https://www.ncbi.nlm.nih.gov/books/NBK25501/','NCBI 官方生物医学文献检索 API，可补充 PMID、MeSH 和出版状态。','全球生物医学与生命科学期刊','none',NULL,'available',0,0,40,'["PMID","MeSH","出版状态","作者"]','Europe PMC 已覆盖大量 PubMed 内容，启用前需控制重复请求。'),
('openalex','OpenAlex','citation','https://openalex.org/','https://developers.openalex.org/guides/authentication','开放学术图谱，适合作者身份、机构、主题、引用和开放获取关系。','全球跨学科学术图谱','api_key','OPENALEX_API_KEY','requires_config',0,0,50,'["作者 ID","机构","引用","主题","开放获取"]','需要免费 API key；配置后可显著改善同名作者消歧。'),
('semantic_scholar','Semantic Scholar','citation','https://www.semanticscholar.org/','https://api.semanticscholar.org/api-docs/','论文与作者图谱，可补充引用、参考文献、摘要及影响力信号。','全球跨学科论文与引用图谱','api_key','SEMANTIC_SCHOLAR_API_KEY','requires_config',0,0,60,'["作者 ID","引用","参考文献","摘要","推荐"]','建议配置 API key 后启用，避免匿名配额不稳定。'),
('orcid','ORCID Public API','identity','https://orcid.org/','https://info.orcid.org/what-is-orcid/services/public-api/','研究者持久身份，可用于导师身份确认及跨数据库作者对齐。','全球研究者身份与公开成果记录','oauth','ORCID_CLIENT_ID','requires_config',0,0,70,'["ORCID","作者身份","公开成果","机构"]','需要注册 Public API 客户端；主要用于身份核验，不直接作为唯一论文事实源。'),
('unpaywall','Unpaywall','fulltext','https://unpaywall.org/','https://unpaywall.org/products/api','按 DOI 补充开放获取状态和合法全文位置。','全球开放获取位置与版本','api_key','UNPAYWALL_EMAIL','requires_config',0,0,80,'["开放获取","全文链接","版本"]','需要联系邮箱参数；只增强已有 DOI，不做导师论文发现。');
