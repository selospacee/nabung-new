type AccountLike = { id: string; name: string }

const MIN_TOKEN = 3

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Cari akun yang disebut dalam ucapan, mis. "pakai BCA", "dari cash", "via gopay".
 * Cocok bila seluruh nama akun muncul sebagai kata utuh, atau salah satu kata nama
 * (min. 3 huruf) yang khas milik satu akun saja muncul. Kata yang dipakai bersama
 * beberapa akun (mis. "bank") diabaikan. Mengembalikan id bila tepat satu akun cocok,
 * selain itu null.
 */
export function matchAccountFromText(text: string, accounts: AccountLike[] | null | undefined): string | null {
  const words = tokenize(text || '')
  if (!words.length || !accounts?.length) return null
  const wordSet = new Set(words)
  const padded = ` ${words.join(' ')} `

  const entries = accounts
    .map(a => {
      const nameTokens = tokenize(a.name || '')
      return { id: a.id, nameTokens, keyTokens: [...new Set(nameTokens.filter(t => t.length >= MIN_TOKEN))] }
    })
    .filter(e => e.nameTokens.length > 0)

  const tokenOwners = new Map<string, Set<string>>()
  for (const e of entries) {
    for (const t of e.keyTokens) {
      const owners = tokenOwners.get(t) ?? new Set<string>()
      owners.add(e.id)
      tokenOwners.set(t, owners)
    }
  }

  const phrases = new Map<string, string>()
  const hits = new Set<string>()
  for (const e of entries) {
    const phrase = e.nameTokens.join(' ')
    if (phrase.length >= MIN_TOKEN && padded.includes(` ${phrase} `)) {
      phrases.set(e.id, ` ${phrase} `)
      hits.add(e.id)
    } else if (e.keyTokens.some(t => tokenOwners.get(t)?.size === 1 && wordSet.has(t))) {
      hits.add(e.id)
    }
  }

  // Nama yang hanya bagian dari nama akun lain yang juga disebut ("Cash" vs "Cash BCA") dikalahkan.
  for (const [id, phrase] of phrases) {
    for (const [otherId, other] of phrases) {
      if (otherId !== id && other !== phrase && other.includes(phrase)) hits.delete(id)
    }
  }

  return hits.size === 1 ? [...hits][0] : null
}
