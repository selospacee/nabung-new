import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { formatCurrency } from '../utils/currency'

interface LocatedTxn {
  id: string
  latitude: number | null
  longitude: number | null
  amount: number
  date: string
  merchant?: string | null
  description?: string | null
  location?: string | null
}

interface TxnMapProps {
  locatedTxns: LocatedTxn[]
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }
  mapProvider: 'openstreetmap' | 'google'
  currency: string
}

// Fit the map to the transaction bounds when the data set changes
function FitBounds({ bounds }: { bounds: TxnMapProps['bounds'] }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(
      [
        [bounds.minLat, bounds.minLng],
        [bounds.maxLat, bounds.maxLng],
      ],
      { padding: [20, 20] }
    )
  }, [map, bounds])
  return null
}

// Real interactive map (pan/zoom) with transaction pins placed in map
// coordinates — pins stay anchored to their location when the map moves.
export function TxnMap({ locatedTxns, bounds, mapProvider, currency }: TxnMapProps) {
  const points = locatedTxns.filter(
    (tx): tx is LocatedTxn & { latitude: number; longitude: number } =>
      tx.latitude !== null && tx.longitude !== null
  )

  const center: [number, number] = [(bounds.minLat + bounds.maxLat) / 2, (bounds.minLng + bounds.maxLng) / 2]

  return (
    <MapContainer
      center={center}
      zoom={13}
      scrollWheelZoom
      className="absolute inset-0 w-full h-full z-0"
    >
      {mapProvider === 'google' ? (
        <TileLayer
          url="https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          // subdomains and attribution are not valid props in react-leaflet v5
        />
      ) : (
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // attribution is not a valid prop in react-leaflet v5
        />
      )}

      <FitBounds bounds={bounds} />

      {points.map(tx => (
        <CircleMarker
                  key={tx.id}
                  center={[tx.latitude, tx.longitude]}
                  // radius is not a valid prop in react-leaflet v5, use pathOptions for styling
                  pathOptions={{
                    fillColor: 'var(--color-primary)',
                    color: '#ffffff',
                    weight: 2,
                    fillOpacity: 0.95,
                  }}
                >
          <Popup>
            <div className="text-sm">
              <p className="font-medium">{tx.merchant || tx.description || 'Transaction'}</p>
              <p className="font-mono">{formatCurrency(tx.amount, currency)}</p>
              <p className="text-muted-foreground">{tx.date}</p>
              {tx.location && <p className="text-muted-foreground mt-1">{tx.location}</p>}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
