/** 可替换的联网搜索接口。实现方不得记录检索词。 */

export type SearchHit = {
  title: string;
  url: string;
  summary: string | null;
  siteName: string | null;
  datePublished: string | null;
};

export interface SearchProvider {
  search(query: string): Promise<SearchHit[]>;
}

export class SearchError extends Error {}
