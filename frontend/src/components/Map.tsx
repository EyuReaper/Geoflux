import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as h3 from 'h3-js'
import { useStore } from '../store/useStore'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://demotiles.maplibre.org/style.json'
}

const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const { mapState, setMapState, filteredData: data, activeModes, mapStyle, mapStyleType } = useStore()

  const updateLayers = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapInstance.isStyleLoaded()) return

    // Ensure source exists
    if (!mapInstance.getSource('geoflux-data')) {
      mapInstance.addSource('geoflux-data', {
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

    const layers = ['geoflux-markers', 'geoflux-heatmap', 'geoflux-choropleth']
    layers.forEach(l => {
      if (mapInstance.getLayer(l)) mapInstance.removeLayer(l)
    })

    // Layer Order: Heatmap (Bottom) -> Area/Choropleth -> Markers (Top)
    
    if (activeModes.includes('heatmap')) {
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
    }

    if (activeModes.includes('choropleth')) {
      let gridFeatures: GeoJSON.Feature[] = []

      if (mapStyle.gridType === 'hex') {
        const zoom = mapInstance.getZoom()
        // Map zoom to H3 resolution
        const resolution = Math.max(0, Math.min(15, Math.floor(zoom / 1.5) + mapStyle.gridResolution - 4))
        
        const h3Grid: Record<string, { count: number; sum: number }> = {}
        
        data.forEach(d => {
          try {
            const h3Index = h3.latLngToCell(d.lat, d.lng, resolution)
            if (!h3Grid[h3Index]) {
              h3Grid[h3Index] = { count: 0, sum: 0 }
            }
            h3Grid[h3Index].count++
            h3Grid[h3Index].sum += d.value || 0
          } catch {
            // Ignore points outside valid H3 range
          }
        })

        gridFeatures = Object.entries(h3Grid).map(([index, g]) => {
          const boundary = h3.cellToBoundary(index)
          const coordinates = [boundary.map(coord => [coord[1], coord[0]])]
          coordinates[0].push(coordinates[0][0])
          
          return {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates
            },
            properties: { value: g.sum / g.count, count: g.count, h3Index: index }
          }
        })
      } else {
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

        gridFeatures = Object.values(grid).map(g => ({
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
      }

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

      if (mapStyle.is3D) {
        mapInstance.addLayer({
          id: 'geoflux-choropleth',
          type: 'fill-extrusion',
          source: 'geoflux-grid',
          paint: {
            'fill-extrusion-color': [
              'interpolate', ['linear'], ['get', 'value'],
              0, 'rgba(0,0,0,0)',
              25, mapStyle.colorScale[0],
              50, mapStyle.colorScale[1],
              75, mapStyle.colorScale[2],
              100, mapStyle.colorScale[3]
            ],
            'fill-extrusion-height': ['*', ['get', 'value'], 5000], 
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': mapStyle.opacity
          }
        })
        mapInstance.easeTo({ pitch: 45, duration: 1000 })
      } else {
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
        mapInstance.easeTo({ pitch: 0, duration: 1000 })
      }
    }

    if (activeModes.includes('markers')) {
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
    }
  }, [activeModes, mapStyle, data])

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
      
      popup.current = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false
      })
      
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

    m.on('mousemove', (e) => {
      const mapInstance = map.current
      if (!mapInstance || !mapInstance.isStyleLoaded()) return
      
      const potentialLayers = ['geoflux-markers', 'geoflux-heatmap', 'geoflux-choropleth']
      const layers = potentialLayers.filter(l => mapInstance.getLayer(l))
      
      if (layers.length === 0) return

      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers
      })

      if (features.length > 0) {
        mapInstance.getCanvas().style.cursor = 'pointer'
        const feature = features[0]
        const props = feature.properties
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 10px; background: rgba(0,0,0,0.8); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; font-family: sans-serif; min-width: 120px;">
              <div style="font-size: 10px; opacity: 0.4; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Value</div>
              <div style="font-size: 14px; font-weight: bold; color: #06b6d4;">${(props.value || 0).toFixed(2)}</div>
              ${props.category ? `<div style="font-size: 10px; margin-top: 4px; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; display: inline-block;">${props.category}</div>` : ''}
              ${props.count ? `<div style="font-size: 9px; opacity: 0.3; margin-top: 4px;">Aggregated points: ${props.count}</div>` : ''}
            </div>
          `)
          .addTo(mapInstance)
      } else {
        mapInstance.getCanvas().style.cursor = ''
        popup.current?.remove()
      }
    })

    m.on('styledata', () => {
      updateLayers()
    })

    m.on('move', () => {
      const { lng, lat } = m.getCenter()
      const b = m.getBounds()
      setMapState({
        lng,
        lat,
        zoom: m.getZoom(),
        pitch: m.getPitch(),
        bearing: m.getBearing(),
        bounds: {
          sw: [b.getWest(), b.getSouth()],
          ne: [b.getEast(), b.getNorth()]
        }
      })
    })

    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    
    // Ensure map fits container after data load
    setTimeout(() => {
      mapInstance.resize()
    }, 100)
  }, [data, updateLayers, isLoaded])

  useEffect(() => {
    updateLayers()
  }, [activeModes, mapStyle, updateLayers])

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
