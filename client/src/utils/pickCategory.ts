type CategoryLike = { id: string; name: string; type: string }

const FALLBACK_NAMES = ['lainnya', 'lain-lain', 'other', 'others', 'miscellaneous', 'misc']

/**
 * Category to pre-fill on the transaction form. Uses the matched category when there is one,
 * otherwise falls back to an "Other"-style category, then to the first category of the type.
 */
export function pickCategoryId(categories: CategoryLike[] | undefined, type: string, suggestedId: string | null | undefined): string {
  if (suggestedId) return suggestedId
  const ofType = (categories || []).filter(c => c.type === type)
  const named = ofType.find(c => FALLBACK_NAMES.includes(c.name.trim().toLowerCase()))
  return (named ?? ofType[0])?.id ?? ''
}
