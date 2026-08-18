// apps/alt-codes/pages/category/@id/+data.server.ts
import type { PageContextServer } from 'vike/types';
import { render } from 'vike/abort';
import type { CharacterEntry } from '../../../src/unicode-data';
import { CATEGORIES } from '../../../src/unicode-data';

export type CategoryData = {
  categoryId: string;
  categoryName: string;
  characters: CharacterEntry[];
};

export async function data(pageContext: PageContextServer): Promise<CategoryData> {
  const categoryId = pageContext.routeParams.id;
  const category = CATEGORIES.find((c) => c.id === categoryId);
  if (!category) throw render(404, `Unknown category: ${categoryId}.`);

  const characters = pageContext.globalContext.unicodeData.byCategory.get(categoryId) ?? [];

  return {
    categoryId,
    categoryName: category.name,
    characters,
  };
}
