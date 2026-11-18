/**
 * Lokasi otomatis untuk input foto dan suara: lokasi perangkat, pencarian nama tempat
 * (Google bila ada kunci, kalau tidak OpenStreetMap Nominatim), dan ekstraksi nama tempat dari teks.
 */
export interface GeoResult {
  location: string
  latitude: number
  longitude: number
  source: 'place' | 'device'
}

export interface LatLng { latitude: number; longitude: number }

const PREF_KEY = 'nabung.autoLocation'

/** Preferensi per perangkat. Default MATI: lokasi dan teks tempat dikirim ke layanan pihak ketiga. */
export function getAutoLocationPref(): boolean {
  try { return localStorage.getItem(PREF_KEY) === '1' } catch { return false }
}
export function setAutoLocationPref(on: boolean): void {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* penyimpanan tidak tersedia */ }
}

/** Posisi perangkat, atau null bila ditolak/gagal/timeout. Tidak pernah melempar. */
export function getDevicePosition(timeoutMs = 8000): Promise<LatLng | null> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}

/** Cari nama tempat. `near` mempersempit hasil ke sekitar posisi itu (mis. "Indomaret" terdekat). */
export async function geocodePlace(query: string, near?: LatLng | null): Promise<GeoResult | null> {
  const q = query.trim()
  if (q.length < 3) return null
  try {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (key) {
      const bias = near ? `&bounds=${near.latitude - 0.2},${near.longitude - 0.2}|${near.latitude + 0.2},${near.longitude + 0.2}` : ''
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}${bias}&key=${key}`)
      const d = await r.json()
      if (d.status === 'OK' && d.results?.length) {
        const { lat, lng } = d.results[0].geometry.location
        return { location: d.results[0].formatted_address, latitude: lat, longitude: lng, source: 'place' }
      }
    }
    const view = near
      ? `&viewbox=${near.longitude - 0.2},${near.latitude + 0.2},${near.longitude + 0.2},${near.latitude - 0.2}`
      : ''
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}${view}`)
    const d = await r.json()
    if (Array.isArray(d) && d.length) {
      return { location: d[0].display_name || q, latitude: parseFloat(d[0].lat), longitude: parseFloat(d[0].lon), source: 'place' }
    }
  } catch (err) {
    console.warn('[Geocode] place search failed:', err)
  }
  return null
}

/** Nama alamat dari koordinat (untuk label lokasi perangkat). */
export async function reverseGeocode(p: LatLng): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${p.latitude}&lon=${p.longitude}`)
    const d = await r.json()
    return d?.display_name || null
  } catch {
    return null
  }
}

/**
 * Lokasi otomatis: coba cari nama tempat (di sekitar perangkat), jika tidak ketemu pakai posisi
 * perangkat. Mengembalikan null bila keduanya tidak tersedia.
 */
export async function resolveAutoLocation(placeText: string | null, device: LatLng | null): Promise<GeoResult | null> {
  if (placeText) {
    const hit = await geocodePlace(placeText, device)
    if (hit) return hit
  }
  if (device) {
    const label = await reverseGeocode(device)
    return {
      location: label || `${device.latitude.toFixed(5)}, ${device.longitude.toFixed(5)}`,
      latitude: device.latitude,
      longitude: device.longitude,
      source: 'device',
    }
  }
  return null
}

const AMOUNT_TAIL = /\s+(?:seharga|sebesar|dengan|total)?\s*(?:rp\.?\s*)?[\d.,]+\s*(?:ribu|rb|k|juta|jt)?\b.*$/i
const DATE_WORDS = /\b(hari ini|kemarin|kemarin lusa|besok|today|yesterday|tomorrow)\b/gi

/**
 * Nama tempat dari ucapan: bagian setelah "di" / "at" / "in" terakhir.
 * "beli kopi di Starbucks Sudirman 25 ribu" -> "Starbucks Sudirman". Null bila tidak ada.
 */
export function extractPlaceFromSpeech(text: string): string | null {
  const m = text.match(/^.*\b(?:di|at|in)\s+(.+)$/i) // .* serakah: memakai kata penunjuk TERAKHIR
  if (!m) return null
  let place = m[1]
  place = place.replace(AMOUNT_TAIL, '').replace(DATE_WORDS, '').replace(/\s+/g, ' ').trim()
  return place.length >= 3 ? place : null
}

const ADDRESS_HINT = /\b(jl\.?|jalan|street|st\.|road|rd\.|no\.?|rt|rw|kec|kel|kota|mall|plaza)\b/i

/** Nama toko (+ alamat bila terbaca) dari baris atas struk. Null bila tidak ada. */
export function extractPlaceFromReceipt(lines: string[]): string | null {
  const head = lines.slice(0, 8).map(l => l.trim()).filter(l => l.length > 3 && !/^[\d\s.,:/-]+$/.test(l))
  if (head.length === 0) return null
  const name = head[0]
  const address = head.slice(1).find(l => ADDRESS_HINT.test(l))
  return (address ? `${name}, ${address}` : name).replace(/[^\p{L}\p{N}\s.,/-]/gu, ' ').replace(/\s+/g, ' ').trim() || null
}
