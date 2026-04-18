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
  const { 
    mapState, setMapState, activeModes, mapStyle, 
    mapStyleType, setSelectedEntity, datasets, filters, 
    timeline, setViewportFilteredData
  } = useStore()

  // Track added layers and sources to manage them surgically
  const activeResources = useRef<{
    sources: Set<string>,
    layers: Set<string>
  }>({
    sources: new Set(),
    layers: new Set()
  })

  const updateLayers = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapInstance.isStyleLoaded()) return

    const visibleDatasets = datasets.filter(ds => ds.isVisible)
    const newSourceIds = new Set<string>()
    const newLayerIds = new Set<string>()

    // Build MapLibre filter
    const mapLibreFilter: any[] = ['all']
    mapLibreFilter.push(['>=', ['get', 'value'], filters.minValue])
    mapLibreFilter.push(['<=', ['get', 'value'], filters.maxValue])
    
    if (filters.categories.length > 0) {
      mapLibreFilter.push(['in', ['get', 'category'], ['literal', filters.categories]])
    }
    
    if (timeline.startTime !== timeline.endTime) {
      mapLibreFilter.push(['<=', ['get', 'timestamp'], timeline.currentTime])
    }

    visibleDatasets.forEach(ds => {
      const sourceId = `geoflux-source-${ds.id}`
      newSourceIds.add(sourceId)
      
      const tileUrl = activeModes.includes('area') || activeModes.includes('choropleth')
        ? `${API_URL}/datasets/${ds.id}/tiles/{z}/{x}/{y}.pbf?mode=area`
        : `${API_URL}/datasets/${ds.id}/tiles/{z}/{x}/{y}.pbf`

      if (!mapInstance.getSource(sourceId)) {
        mapInstance.addSource(sourceId, {
          type: 'vector',
          tiles: [tileUrl],
          maxzoom: 14
        })
      } else {
        // Update tiles if mode changed
        const source = mapInstance.getSource(sourceId) as maplibregl.VectorTileSource
        if (source.tiles && source.tiles[0] !== tileUrl) {
          mapInstance.removeSource(sourceId)
          mapInstance.addSource(sourceId, {
            type: 'vector',
            tiles: [tileUrl],
            maxzoom: 14
          })
        }
      }

      // 1. Heatmap Layer
      // ... (existing heatmap logic)

      // 2. 3D Extrusion / Area Layer
      if (activeModes.includes('area') || activeModes.includes('choropleth')) {
        const layerId = `geoflux-area-${ds.id}`
        newLayerIds.add(layerId)
        
        if (mapStyle.is3D) {
          // Use fill-extrusion for 3D
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId)
          const extrusionLayerId = `${layerId}-3d`
          newLayerIds.add(extrusionLayerId)

          if (!mapInstance.getLayer(extrusionLayerId)) {
            mapInstance.addLayer({
              id: extrusionLayerId,
              type: 'fill-extrusion',
              source: sourceId,
              'source-layer': 'geoflux-layer',
              paint: {}
            })
          }
          
          mapInstance.setFilter(extrusionLayerId, mapLibreFilter as any)
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-height', [
            'interpolate', ['linear'], ['get', 'value'],
            0, 0,
            100, 100 * mapStyle.extrusionScale
          ])
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-color', [
            'interpolate', ['linear'], ['get', 'value'],
            0, 'rgba(0,0,0,0)',
            10, mapStyle.colorScale[0],
            30, mapStyle.colorScale[1],
            60, mapStyle.colorScale[2],
            100, mapStyle.colorScale[3]
          ])
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-opacity', mapStyle.opacity)
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-base', 0)
        } else {
          // Use circle/fill for 2D
          if (!mapInstance.getLayer(layerId)) {
            mapInstance.addLayer({
              id: layerId,
              type: 'circle',
              source: sourceId,
              'source-layer': 'geoflux-layer',
              paint: {
                'circle-pitch-alignment': 'map',
                'circle-pitch-scale': 'viewport',
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(255,255,255,0.1)'
              }
            })
          }
          
          const baseRadius = 10 * Math.pow(2, mapStyle.gridResolution - 4)
          mapInstance.setFilter(layerId, mapLibreFilter as any)
          mapInstance.setPaintProperty(layerId, 'circle-radius', [
            'interpolate', ['exponential', 2], ['zoom'],
            0, baseRadius / 10,
            20, baseRadius * 100
          ])
          mapInstance.setPaintProperty(layerId, 'circle-color', [
            'interpolate', ['linear'], ['get', 'value'],
            0, 'rgba(0,0,0,0)',
            10, mapStyle.colorScale[0],
            30, mapStyle.colorScale[1],
            60, mapStyle.colorScale[2],
            100, mapStyle.colorScale[3]
          ])
          mapInstance.setPaintProperty(layerId, 'circle-opacity', mapStyle.opacity)
        }
      }

      // 3. Markers Layer
      if (activeModes.includes('markers')) {
        const layerId = `geoflux-markers-${ds.id}`
        newLayerIds.add(layerId)
        if (!mapInstance.getLayer(layerId)) {
          mapInstance.addLayer({
            id: layerId,
            type: 'circle',
            source: sourceId,
            'source-layer': 'geoflux-layer',
            paint: {
              'circle-stroke-width': 1,
              'circle-stroke-color': '#fff',
              'circle-stroke-opacity': 0.5
            }
          })
        }
        mapInstance.setFilter(layerId, mapLibreFilter as any)
        mapInstance.setPaintProperty(layerId, 'circle-radius', [
          'interpolate', ['linear'], ['zoom'],
          5, mapStyle.pointSize,
          15, mapStyle.pointSize * 2
        ])
        mapInstance.setPaintProperty(layerId, 'circle-color', ds.color)
        mapInstance.setPaintProperty(layerId, 'circle-opacity', mapStyle.opacity)
      }
    })

    // Remove unused layers
    activeResources.current.layers.forEach(layerId => {
      if (!newLayerIds.has(layerId)) {
        if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId)
      }
    })

    // Remove unused sources
    activeResources.current.sources.forEach(sourceId => {
      if (!newSourceIds.has(sourceId)) {
        // Must remove all layers using this source first (they should be in unused layers)
        if (mapInstance.getSource(sourceId)) mapInstance.removeSource(sourceId)
      }
    })

    activeResources.current.layers = newLayerIds
    activeResources.current.sources = newSourceIds

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
        closeOnClick: false,
        className: 'geoflux-popup'
      })
      
      updateLayers()
    })

    m.on('click', (e) => {
      const mapInstance = map.current
      if (!mapInstance || !mapInstance.isStyleLoaded()) return
      
      const layers = Array.from(activeResources.current.layers)
      if (layers.length === 0) return

      const features = mapInstance.queryRenderedFeatures(e.point, { layers })

      if (features.length > 0) {
        const feature = features[0]
        const props = feature.properties
        
        setSelectedEntity({
          type: feature.layer.id.includes('area') ? 'cell' : 'point',
          data: {
            ...props,
            id: props.id || Math.random(),
            lat: e.lngLat.lat, // Approximate if not in props
            lng: e.lngLat.lng,
            metadata: props 
          }
        })
      } else {
        setSelectedEntity(null)
      }
    })

    m.on('mousemove', (e) => {
      const mapInstance = map.current
      if (!mapInstance || !mapInstance.isStyleLoaded()) return
      
      const layers = Array.from(activeResources.current.layers)
      if (layers.length === 0) return

      const features = mapInstance.queryRenderedFeatures(e.point, { layers })

      if (features.length > 0) {
        mapInstance.getCanvas().style.cursor = 'pointer'
        const props = features[0].properties
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 12px; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: white; font-family: 'Inter', sans-serif; min-width: 140px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
              <div style="font-size: 9px; opacity: 0.5; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 6px;">Data Insights</div>
              <div style="display: flex; align-items: baseline; gap: 4px;">
                <div style="font-size: 18px; font-weight: 900; color: #06b6d4;">${(props.value || 0).toFixed(2)}</div>
                <div style="font-size: 10px; opacity: 0.4;">units</div>
              </div>
              ${props.category ? `
                <div style="margin-top: 8px; display: flex; align-items: center; gap: 6px;">
                  <div style="width: 6px; h-6px; border-radius: 50%; background: #06b6d4;"></div>
                  <div style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8);">${props.category}</div>
                </div>
              ` : ''}
              ${props.timestamp ? `
                <div style="font-size: 9px; opacity: 0.3; margin-top: 6px; font-mono">
                  ${new Date(props.timestamp).toLocaleString()}
                </div>
              ` : ''}
            </div>
          `)
          .addTo(mapInstance)
      } else {
        mapInstance.getCanvas().style.cursor = ''
        popup.current?.remove()
      }
    })

    const updateViewportData = () => {
      const mapInstance = map.current
      if (!mapInstance) return

      const layers = Array.from(activeResources.current.layers)
      if (layers.length === 0) {
        setViewportFilteredData([])
        return
      }

      const features = mapInstance.queryRenderedFeatures({ layers })
      
      const dataPoints = features.map(f => ({
        id: f.properties?.id || Math.random(),
        datasetId: f.layer.id.split('-').pop() || '',
        lat: (f.geometry as any).type === 'Point' ? (f.geometry as any).coordinates[1] : 0,
        lng: (f.geometry as any).type === 'Point' ? (f.geometry as any).coordinates[0] : 0,
        value: f.properties?.value,
        category: f.properties?.category,
        timestamp: f.properties?.timestamp,
        metadata: f.properties || {}
      }))

      setViewportFilteredData(dataPoints)
    }

    m.on('moveend', () => {
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
      updateViewportData()
    })

    m.on('styledata', () => {
      updateLayers()
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
    <div className="w-full h-full relative bg-[#050505]">
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md z-10">
          <div className="flex flex-col items-center gap-6">
            <div className="relative">
              <div className="w-16 h-16 border-2 border-cyan-500/20 rounded-full" />
              <div className="absolute inset-0 w-16 h-16 border-t-2 border-cyan-500 rounded-full animate-spin" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="text-cyan-500 font-black tracking-[0.2em] text-sm uppercase">GeoFlux Engine</span>
              <span className="text-white/20 text-[10px] font-medium uppercase tracking-widest">Initialising Spatial Core</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Map Overlay HUD */}
      <div className="absolute bottom-8 left-8 z-10 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">System Online</span>
          </div>
          <div className="text-[10px] font-mono text-white/20">
            {mapState.lat.toFixed(4)}°N, {mapState.lng.toFixed(4)}°E
          </div>
        </div>
      </div>
    </div>
  )
}

export default Map
