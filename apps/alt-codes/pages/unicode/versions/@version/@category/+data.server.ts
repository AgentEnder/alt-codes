import type { PageContextServer } from 'vike/types';
import { render } from 'vike/abort';
import { categoryName } from '../../../../../src/unicode-data';

// Only metadata is rendered server-side; the (potentially huge) glyph list is fetched
// client-side from /generated/versions/{version}/{categoryId}.json so the prerendered
// HTML stays tiny even for the 11k+ Seal characters in Unicode 18.0.
export type VersionCategoryData = {
  version: string;
  categoryId: string;
  name: string;
  count: number;
};

export async function data(pageContext: PageContextServer): Promise<VersionCategoryData> {
  const { version, category } = pageContext.routeParams;
  const entries = pageContext.globalContext.unicodeData.byVersion.get(version) ?? [];
  const count = entries.reduce((n, e) => (e.categoryId === category ? n + 1 : n), 0);
  if (count === 0) throw render(404, `No glyphs for Unicode ${version} / ${category}.`);
  return { version, categoryId: category, name: categoryName(category), count };
}
