ALTER TABLE `papers` ADD `pmcid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `papers_pmcid_unique` ON `papers` (`pmcid`);--> statement-breakpoint
UPDATE `paper_providers` SET `status` = 'active', `enabled` = 1, `discovery_enabled` = 1, `priority` = 25,
`api_docs_url` = 'https://info.arxiv.org/help/api/index.html',
`notes` = '已自动启用；使用官方 Atom API，按作者与主题筛选近 18 个月预印本，并保留版本核验状态。高同名风险导师因 API 不含机构字段而安全跳过。',
`updated_at` = CURRENT_TIMESTAMP WHERE `id` = 'arxiv';--> statement-breakpoint
UPDATE `paper_providers` SET `status` = 'active', `enabled` = 1, `discovery_enabled` = 1, `priority` = 35,
`api_docs_url` = 'https://www.ncbi.nlm.nih.gov/books/NBK25501/',
`notes` = '已自动启用；通过 NCBI ESearch + EFetch 保存 PMID、DOI、摘要、出版类型和可用 PMCID。无密钥模式严格限速。',
`updated_at` = CURRENT_TIMESTAMP WHERE `id` = 'pubmed';--> statement-breakpoint
UPDATE `paper_providers` SET `status` = 'active', `enabled` = 1, `discovery_enabled` = 1, `priority` = 45,
`api_docs_url` = 'https://www.ncbi.nlm.nih.gov/home/develop/api/',
`notes` = '已自动启用；通过 NCBI PMC 检索开放全文记录，保存 PMCID，并与 PubMed、Europe PMC 按 DOI/PMID/PMCID 合并。只覆盖 PMC 可提供的内容。',
`updated_at` = CURRENT_TIMESTAMP WHERE `id` = 'pmc';--> statement-breakpoint
UPDATE `paper_providers` SET `status` = 'active', `enabled` = 1, `discovery_enabled` = 1, `priority` = 60,
`api_docs_url` = 'https://doaj.org/api/docs',
`notes` = '已自动启用 DOAJ API v4；发现开放获取文章并保存 DOI、期刊与全文链接。元数据缺失或超出 18 个月的记录不会写入候选。',
`updated_at` = CURRENT_TIMESTAMP WHERE `id` = 'doaj';
