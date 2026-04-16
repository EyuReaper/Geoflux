import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useStore, API_URL } from '../store/useStore'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://demotiles.maplibre.org/style.json'
}

const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const { mapState, setMapState, activeModes, mapStyle, mapStyleType, setSelectedEntity, datasets, filters, timeline } = useStore()

  const updateLayers = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapInstance.isStyleLoaded()) return

    // ... (existing clear logic)
    const existingSources = Object.keys(mapInstance.getStyle().sources || {})
    const geofluxSources = existingSources.filter(s => s.startsWith('geoflux-'))
    const geofluxLayers = (mapInstance.getStyle().layers || []).filter(l => l.id.startsWith('geoflux-'))

    geofluxLayers.forEach(l => mapInstance.removeLayer(l.id))
    geofluxSources.forEach(s => mapInstance.removeSource(s))

    // Build MapLibre filter
    const mapLibreFilter: any[] = ['all']
    
    // Value range filter
    mapLibreFilter.push(['>=', ['get', 'value'], filters.minValue])
    mapLibreFilter.push(['<=', ['get', 'value'], filters.maxValue])
    
    // Category filter
    if (filters.categories.length > 0) {
      mapLibreFilter.push(['in', ['get', 'category'], ['literal', filters.categories]])
    }
    
    // Search query filter (simplified for MVT)
    // Note: Complex metadata search is hard in MapLibre filters without specific fields
    
    // Timeline filter
    if (timeline.startTime !== timeline.endTime) {
      mapLibreFilter.push(['<=', ['get', 'timestamp'], timeline.currentTime])
    }

    // Add MVT Sources for each visible dataset
    datasets.filter(ds => ds.isVisible).forEach(ds => {
      const sourceId = `geoflux-source-${ds.id}`
      
      if (!mapInstance.getSource(sourceId)) {
        mapInstance.addSource(sourceId, {
          type: 'vector',
          tiles: [`${API_URL}/datasets/${ds.id}/tiles/{z}/{x}/{y}.pbf`],
          maxzoom: 14
        })
      }

      if (activeModes.includes('heatmap')) {
        mapInstance.addLayer({
          id: `geoflux-heatmap-${ds.id}`,
          type: 'heatmap',
          source: sourceId,
          'source-layer': 'geoflux-layer',
          filter: mapLibreFilter,
          paint: {
            // ... (existing paint logic)
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

      if (activeModes.includes('markers')) {
        mapInstance.addLayer({
          id: `geoflux-markers-${ds.id}`,
          type: 'circle',
          source: sourceId,
          'source-layer': 'geoflux-layer',
          filter: mapLibreFilter,
          paint: {
            'circle-radius': mapStyle.pointSize,
            'circle-color': ds.color,
            'circle-opacity': mapStyle.opacity,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
          }
        })
      }
    })
  }, [activeModes, mapStyle, datasets, filters, timeline])

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
      
      updateLayers()
    })

    m.on('click', (e) => {
      const mapInstance = map.current
      if (!mapInstance || !mapInstance.isStyleLoaded()) return
      
      const layers = mapInstance.getStyle().layers.filter(l => l.id.startsWith('geoflux-')).map(l => l.id)
      
      if (layers.length === 0) return

      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers
      })

      if (features.length > 0) {
        const feature = features[0]
        const props = feature.properties
        
        if (feature.layer.id.includes('markers')) {
          setSelectedEntity({
            type: 'point',
            data: {
              ...props,
              metadata: props 
            }
          })
        } else if (feature.layer.id.includes('choropleth')) {
          setSelectedEntity({
            type: 'cell',
            data: props
          })
        }
      } else {
        setSelectedEntity(null)
      }
    })

    m.on('mousemove', (e) => {
      const mapInstance = map.current
      if (!mapInstance || !mapInstance.isStyleLoaded()) return
      
      const layers = mapInstance.getStyle().layers.filter(l => l.id.startsWith('geoflux-')).map(l => l.id)
      
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
    updateLayers()
    
    const mapInstance = map.current
    if (mapInstance && isLoaded) {
      setTimeout(() => {
        mapInstance.resize()
      }, 100)
    }
  }, [updateLayers, isLoaded])

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
