export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  sources: readonly string[];
}

export interface KnowledgeSearchResult extends KnowledgeCard {
  score: number;
  matchedTerms: string[];
}

export function tokenize(text: string): string[];
export function retrieve(
  query: string,
  cards: readonly KnowledgeCard[],
  options?: { limit?: number; maxChars?: number }
): KnowledgeSearchResult[];
