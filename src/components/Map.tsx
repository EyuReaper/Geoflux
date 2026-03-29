import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStore } from '../store/useStore'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://demotiles.maplibre.org/style.json'
}

const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const { mapState, setMapState, data, mode, mapStyle, mapStyleType } = useStore()

  const updateLayers = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapInstance.isStyleLoaded()) return

    const layers = ['geoflux-markers', 'geoflux-heatmap', 'geoflux-choropleth']
    layers.forEach(l => {
      if (mapInstance.getLayer(l)) mapInstance.removeLayer(l)
    })

    if (mode === 'markers') {
      if (!mapInstance.getSource('geoflux-data')) return
      mapInstance.addLayer({
        id: 'geoflux-markers',
        type: 'circle',
        source: 'geoflux-data',
        paint: {
          'circle-radius': mapStyle.pointSize,
          'circle-color': mapStyle.pointColor,
          'circle-opacity': mapStyle.opacity,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff'
        }
      })
    } else if (mode === 'heatmap') {
      if (!mapInstance.getSource('geoflux-data')) return
      mapInstance.addLayer({
        id: 'geoflux-heatmap',
        type: 'heatmap',
        source: 'geoflux-data',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'value'], 0, 0, 100, 1],
          'heatmap-intensity': mapStyle.heatmapIntensity,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, mapStyle.colorScale[0],
            0.4, mapStyle.colorScale[1],
            0.6, mapStyle.colorScale[2],
            0.8, mapStyle.colorScale[3]
          ],
          'heatmap-radius': mapStyle.heatmapRadius,
          'heatmap-opacity': mapStyle.opacity
        }
      })
    } else if (mode === 'choropleth') {
      const gridSize = 5
      const grid: Record<string, { count: number; sum: number; lat: number; lng: number }> = {}
      
      data.forEach(d => {
        const latBin = Math.floor(d.lat / gridSize) * gridSize
        const lngBin = Math.floor(d.lng / gridSize) * gridSize
        const key = `${latBin},${lngBin}`
        if (!grid[key]) {
          grid[key] = { count: 0, sum: 0, lat: latBin + gridSize / 2, lng: lngBin + gridSize / 2 }
        }
        grid[key].count++
        grid[key].sum += d.value || 0
      })

      const gridFeatures = Object.values(grid).map(g => ({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [g.lng - gridSize / 2, g.lat - gridSize / 2],
            [g.lng + gridSize / 2, g.lat - gridSize / 2],
            [g.lng + gridSize / 2, g.lat + gridSize / 2],
            [g.lng - gridSize / 2, g.lat + gridSize / 2],
            [g.lng - gridSize / 2, g.lat - gridSize / 2]
          ]]
        },
        properties: { value: g.sum / g.count, count: g.count }
      }))

      if (mapInstance.getSource('geoflux-grid')) {
        (mapInstance.getSource('geoflux-grid') as maplibregl.GeoJSONSource).setData({
          type: 'FeatureCollection',
          features: gridFeatures as GeoJSON.Feature[]
        })
      } else {
        mapInstance.addSource('geoflux-grid', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: gridFeatures as GeoJSON.Feature[] }
        })
      }

      if (mapInstance.getSource('geoflux-grid')) {
        mapInstance.addLayer({
          id: 'geoflux-choropleth',
          type: 'fill',
          source: 'geoflux-grid',
          paint: {
            'fill-color': [
              'interpolate', ['linear'], ['get', 'value'],
              0, 'rgba(0,0,0,0)',
              25, mapStyle.colorScale[0],
              50, mapStyle.colorScale[1],
              75, mapStyle.colorScale[2],
              100, mapStyle.colorScale[3]
            ],
            'fill-opacity': mapStyle.opacity,
            'fill-outline-color': 'rgba(255,255,255,0.1)'
          }
        })
      }
    }
  }, [mode, mapStyle, data])

  useEffect(() => {
    if (!mapContainer.current) return

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLES[mapStyleType],
      center: [mapState.lng, mapState.lat],
      zoom: mapState.zoom,
      pitch: mapState.pitch,
      bearing: mapState.bearing,
    })

    m.on('load', () => {
      map.current = m
      setIsLoaded(true)
      
      if (!m.getSource('geoflux-data')) {
        m.addSource('geoflux-data', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: data.map(d => ({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
              properties: { ...d.metadata, value: d.value, category: d.category }
            } as GeoJSON.Feature))
          }
        })
      }
      
      updateLayers()
    })

    m.on('styledata', () => {
      updateLayers()
    })

    m.on('move', () => {
      const { lng, lat } = m.getCenter()
      setMapState({
        lng,
        lat,
        zoom: m.getZoom(),
        pitch: m.getPitch(),
        bearing: m.getBearing()
      })
    })

    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Respond to style type changes
  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !isLoaded) return

    mapInstance.setStyle(STYLES[mapStyleType])
  }, [mapStyleType, isLoaded])

  useEffect(() => {
    const mapInstance = map.current
    if (!mapInstance || !isLoaded) return

    const source = mapInstance.getSource('geoflux-data') as maplibregl.GeoJSONSource
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: data.map(d => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
          properties: { ...d.metadata, value: d.value, category: d.category }
        } as GeoJSON.Feature))
      })
    }

    updateLayers()
  }, [data, updateLayers, isLoaded])

  useEffect(() => {
    updateLayers()
  }, [mode, mapStyle, updateLayers])

  return (
    <div className="w-full h-full relative bg-[#111]">
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-cyan-500 font-medium tracking-widest text-xs uppercase">Initializing Engine...</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default Map
