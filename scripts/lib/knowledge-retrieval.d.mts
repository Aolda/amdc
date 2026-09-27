export interface KnowledgeCard {
  id: string;
  title: string;
  content: string;
  sources: string[];
}
export function tokenize(text: string): string[];
export function retrieve<T extends KnowledgeCard>(query: string, cards: T[], options?: { limit?: number; maxChars?: number }): (T & { score: number; matchedTerms: string[] })[];
