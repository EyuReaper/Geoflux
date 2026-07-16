import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import * as h3 from 'h3-js'
import { useStore, API_URL } from '../store/useStore'
import type { DataPoint } from '../types'

const STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://demotiles.maplibre.org/style.json'
}

type PointGeometry = {
  type: 'Point'
  coordinates: [number, number]
}

type MapFilter = Parameters<maplibregl.Map['setFilter']>[1]

const isPointGeometry = (geometry: GeoJSON.Geometry): geometry is PointGeometry => (
  geometry.type === 'Point' &&
  Array.isArray(geometry.coordinates) &&
  typeof geometry.coordinates[0] === 'number' &&
  typeof geometry.coordinates[1] === 'number'
)

const buildGeoJson = (data: DataPoint[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: data.map((point) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [point.lng, point.lat]
    },
    properties: {
      id: point.id,
      datasetId: point.datasetId,
      value: point.value ?? 0,
      category: point.category,
      timestamp: typeof point.timestamp === 'number'
        ? point.timestamp
        : new Date(point.timestamp || 0).getTime(),
      ...(point.metadata || {})
    }
  }))
})

const buildGridGeoJson = (data: DataPoint[], gridType: 'hex' | 'square', resolution: number): GeoJSON.FeatureCollection => {
  const grid = new globalThis.Map<string, { value: number; count: number; coords: [number, number][] }>()

  if (gridType === 'hex') {
    // H3 resolution 1-15. Map slider 1-8.
    const h3Res = Math.min(15, Math.max(1, Math.round(resolution) + 1))
    data.forEach(p => {
      const index = h3.latLngToCell(p.lat, p.lng, h3Res)
      const existing = grid.get(index) || { value: 0, count: 0, coords: [] }
      if (existing.count === 0) {
        existing.coords = h3.cellToBoundary(index, true)
      }
      existing.value += (p.value ?? 0)
      existing.count += 1
      grid.set(index, existing)
    })
  } else {
    // Square grid. Resolution 0.001 - 2.
    const res = Math.max(0.001, resolution)
    data.forEach(p => {
      const latBin = Math.floor(p.lat / res) * res
      const lngBin = Math.floor(p.lng / res) * res
      const key = `${latBin},${lngBin}`
      const existing = grid.get(key) || { value: 0, count: 0, coords: [] }
      if (existing.count === 0) {
        existing.coords = [
          [lngBin, latBin],
          [lngBin + res, latBin],
          [lngBin + res, latBin + res],
          [lngBin, latBin + res],
          [lngBin, latBin]
        ]
      }
      existing.value += (p.value ?? 0)
      existing.count += 1
      grid.set(key, existing)
    })
  }

  return {
    type: 'FeatureCollection',
    features: Array.from(grid.values()).map(cell => {
      const lat = cell.coords.reduce((acc, c) => acc + c[1], 0) / cell.coords.length
      const lng = cell.coords.reduce((acc, c) => acc + c[0], 0) / cell.coords.length
      return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [cell.coords] },
        properties: { 
          value: cell.value, 
          count: cell.count, 
          avg: cell.count > 0 ? cell.value / cell.count : 0,
          lat,
          lng
        }
      }
    })
  }
}

const Map = () => {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const popup = useRef<maplibregl.Popup | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const { 
    mapState, setMapState, activeModes, mapStyle, 
    mapStyleType, setSelectedEntity, datasets, filters, 
    timeline, setViewportFilteredData, applySnapshot, regionFocus
  } = useStore()

  // Apply initial snapshot if present in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const snapshot = urlParams.get('s')
    if (snapshot) {
      applySnapshot(snapshot)
    }
  }, [applySnapshot])

  // Track added layers and sources to manage them surgically
  const activeResources = useRef<{
    sources: Set<string>,
    layers: Set<string>
  }>({
    sources: new Set(),
    layers: new Set()
  })

  // Use refs to store previous values for efficient comparison
  // Initialize to null to ensure first update is processed
  const prevFilters = useRef<typeof filters | null>(null)
  const prevActiveModes = useRef<string[] | null>(null)
  const prevMapStyle = useRef<typeof mapStyle | null>(null)

  const updateLayers = useCallback(() => {
    const mapInstance = map.current
    if (!mapInstance || !mapInstance.isStyleLoaded()) return

    const visibleDatasets = datasets.filter(ds => ds.isVisible)
    const newSourceIds = new Set<string>()
    const newLayerIds = new Set<string>()

    const isAreaModeGlobal = activeModes.includes('area') || activeModes.includes('choropleth')

    // Determine if structure needs update (sources or layers added/removed)
    const filtersChanged = JSON.stringify(prevFilters.current) !== JSON.stringify(filters)
    const modesChanged = JSON.stringify(prevActiveModes.current) !== JSON.stringify(activeModes)
    const styleChanged = JSON.stringify(prevMapStyle.current) !== JSON.stringify(mapStyle)

    // Update refs
    prevFilters.current = filters
    prevActiveModes.current = activeModes
    prevMapStyle.current = mapStyle

    visibleDatasets.forEach(ds => {
      const sourceId = `geoflux-source-${ds.id}`
      newSourceIds.add(sourceId)
      const isLocalData = ds.data.length > 0
      const isAggregated = !!ds.aggregatedGeoJson
      const isGridDataset = ds.type === 'grid'
      const isAreaMode = isGridDataset || isAreaModeGlobal
      const sourceLayer = (isLocalData || isAggregated) ? undefined : 'geoflux-layer'

      // Source Management
      if (isAggregated) {
        const existingSource = mapInstance.getSource(sourceId)
        if (!existingSource) {
          mapInstance.addSource(sourceId, { type: 'geojson', data: ds.aggregatedGeoJson! })
        } else if ('setData' in existingSource) {
          (existingSource as maplibregl.GeoJSONSource).setData(ds.aggregatedGeoJson!)
        }
      } else if (isLocalData) {
        const geoJson = isAreaMode 
          ? buildGridGeoJson(ds.data, mapStyle.gridType, mapStyle.gridResolution)
          : buildGeoJson(ds.data)
        
        const existingSource = mapInstance.getSource(sourceId)
        if (!existingSource) {
          mapInstance.addSource(sourceId, { type: 'geojson', data: geoJson })
        } else if ('setData' in existingSource) {
          (existingSource as maplibregl.GeoJSONSource).setData(geoJson)
        }
      } else {
        const resParam = mapStyle.gridType === 'hex' ? mapStyle.gridResolution : (1 / Math.pow(2, mapStyle.gridResolution - 2));
        const params = new URLSearchParams({
          min: filters.minValue.toString(),
          max: filters.maxValue.toString(),
          cats: filters.categories.join(','),
          search: filters.searchQuery
        });

        if (isAreaMode) {
          params.append('mode', 'area');
          params.append('gridType', mapStyle.gridType);
          params.append('res', resParam.toString());
        }

        const tileUrl = `${API_URL}/datasets/${ds.id}/tiles/{z}/{x}/{y}.pbf?${params.toString()}`;
        const existingSource = mapInstance.getSource(sourceId)

        if (!existingSource) {
          mapInstance.addSource(sourceId, { type: 'vector', tiles: [tileUrl], maxzoom: 14 })
        } else {
          const source = existingSource as maplibregl.VectorTileSource & { tiles?: string[] }
          // Update source if essential params changed
          if (filtersChanged || modesChanged || (isAreaMode && styleChanged)) {
             if (!('tiles' in source) || (source.tiles && source.tiles[0] !== tileUrl)) {
              mapInstance.removeSource(sourceId)
              mapInstance.addSource(sourceId, { type: 'vector', tiles: [tileUrl], maxzoom: 14 })
            }
          }
        }
      }

      // Layer Filter & Style Update
      const mapLibreFilterParts: unknown[] = ['all']
      mapLibreFilterParts.push(['>=', ['get', 'value'], filters.minValue])
      mapLibreFilterParts.push(['<=', ['get', 'value'], filters.maxValue])
      if (filters.categories.length > 0) mapLibreFilterParts.push(['in', ['get', 'category'], ['literal', filters.categories]])
      if (timeline.startTime !== timeline.endTime) mapLibreFilterParts.push(['<=', ['get', 'timestamp'], timeline.currentTime])
      const mapLibreFilter = mapLibreFilterParts as MapFilter

      // Heatmap Layer
      if (activeModes.includes('heatmap') && !isGridDataset) {
        const layerId = `geoflux-heatmap-${ds.id}`
        newLayerIds.add(layerId)
        if (!mapInstance.getLayer(layerId)) {
          mapInstance.addLayer({
            id: layerId, type: 'heatmap', source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            maxzoom: 14,
            paint: {
              'heatmap-weight': ['interpolate', ['linear'], ['get', 'value'], 0, 0, 100, 1],
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 14, 3 * mapStyle.heatmapIntensity],
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, mapStyle.colorScale[0], 0.4, mapStyle.colorScale[1], 0.6, mapStyle.colorScale[2], 1.0, mapStyle.colorScale[3]],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 14, mapStyle.heatmapRadius],
              'heatmap-opacity': mapStyle.opacity
            }
          })
        }
        mapInstance.setFilter(layerId, mapLibreFilter)
        mapInstance.setPaintProperty(layerId, 'heatmap-intensity', mapStyle.heatmapIntensity)
        mapInstance.setPaintProperty(layerId, 'heatmap-radius', mapStyle.heatmapRadius)
        mapInstance.setPaintProperty(layerId, 'heatmap-opacity', mapStyle.opacity)
      }

      // 3D/Grid Layers
      if (isAreaMode) {
        const layerId = `geoflux-area-${ds.id}`
        if (mapStyle.is3D) {
          const extrusionLayerId = `${layerId}-3d`
          newLayerIds.add(extrusionLayerId)
          if (!mapInstance.getLayer(extrusionLayerId)) {
            mapInstance.addLayer({
              id: extrusionLayerId, type: 'fill-extrusion', source: sourceId,
              ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
              paint: {}
            })
          }
          mapInstance.setFilter(extrusionLayerId, mapLibreFilter)
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-height', ['interpolate', ['linear'], ['get', 'value'], 0, 0, 100, 100 * mapStyle.extrusionScale])
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-color', ['interpolate', ['linear'], ['get', 'value'], 0, 'rgba(0,0,0,0)', 10, mapStyle.colorScale[0], 30, mapStyle.colorScale[1], 60, mapStyle.colorScale[2], 100, mapStyle.colorScale[3]])
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-opacity', mapStyle.opacity)
          mapInstance.setPaintProperty(extrusionLayerId, 'fill-extrusion-base', 0)
        } else {
          const fillLayerId = `${layerId}-fill`
          newLayerIds.add(fillLayerId)
          if (!mapInstance.getLayer(fillLayerId)) {
            mapInstance.addLayer({
              id: fillLayerId, type: 'fill', source: sourceId,
              ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
              paint: { 'fill-outline-color': 'rgba(255,255,255,0.1)' }
            })
          }
          mapInstance.setFilter(fillLayerId, mapLibreFilter)
          mapInstance.setPaintProperty(fillLayerId, 'fill-color', ['interpolate', ['linear'], ['get', 'value'], 0, 'rgba(0,0,0,0)', 10, mapStyle.colorScale[0], 30, mapStyle.colorScale[1], 60, mapStyle.colorScale[2], 100, mapStyle.colorScale[3]])
          mapInstance.setPaintProperty(fillLayerId, 'fill-opacity', mapStyle.opacity)
        }
      }

      // Markers Layer
      if (activeModes.includes('markers') && !isGridDataset) {
        const layerId = `geoflux-markers-${ds.id}`
        const pulseLayerId = `${layerId}-pulse`
        newLayerIds.add(layerId)
        newLayerIds.add(pulseLayerId)

        if (!mapInstance.getLayer(pulseLayerId)) {
          mapInstance.addLayer({
            id: pulseLayerId, type: 'circle', source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            paint: { 'circle-radius': mapStyle.pointSize * 2, 'circle-color': ds.color, 'circle-opacity': 0.2, 'circle-stroke-width': 2, 'circle-stroke-color': ds.color, 'circle-stroke-opacity': 0.1 }
          })
        }
        if (!mapInstance.getLayer(layerId)) {
          mapInstance.addLayer({
            id: layerId, type: 'circle', source: sourceId,
            ...(sourceLayer ? { 'source-layer': sourceLayer } : {}),
            paint: { 'circle-stroke-width': 1, 'circle-stroke-color': '#fff', 'circle-stroke-opacity': 0.5 }
          })
        }
        mapInstance.setFilter(layerId, mapLibreFilter)
        mapInstance.setFilter(pulseLayerId, mapLibreFilter)
        mapInstance.setPaintProperty(layerId, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 5, mapStyle.pointSize, 15, mapStyle.pointSize * 2])
        mapInstance.setPaintProperty(layerId, 'circle-color', ds.color)
        mapInstance.setPaintProperty(layerId, 'circle-opacity', mapStyle.opacity)
      }
    })

    // Clean up
    activeResources.current.layers.forEach(id => { if (!newLayerIds.has(id) && mapInstance.getLayer(id)) mapInstance.removeLayer(id) })
    activeResources.current.sources.forEach(id => { if (!newSourceIds.has(id) && mapInstance.getSource(id)) mapInstance.removeSource(id) })
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
      // Attach JWT for private vector tiles (MapLibre cannot set headers on tile URLs alone)
      transformRequest: (url, resourceType) => {
        if (
          (resourceType === 'Tile' || resourceType === 'Source') &&
          url.startsWith(API_URL)
        ) {
          const token = useStore.getState().auth.token
          if (token) {
            return {
              url,
              headers: { Authorization: `Bearer ${token}` },
            }
          }
        }
        return { url }
      },
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
        const props = feature.properties ?? {}
        
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
        const props = features[0].properties ?? {}
        const value = Number(props.value || 0)
        
        popup.current
          ?.setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding: 12px; background: rgba(10,10,10,0.9); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; color: white; font-family: 'Inter', sans-serif; min-width: 140px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);">
              <div style="font-size: 9px; opacity: 0.5; text-transform: uppercase; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 6px;">Data Insights</div>
              <div style="display: flex; align-items: baseline; gap: 4px;">
                <div style="font-size: 18px; font-weight: 900; color: #06b6d4;">${value.toFixed(2)}</div>
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

      const features = mapInstance.queryRenderedFeatures(undefined, { layers })
      
      const dataPoints: DataPoint[] = features.map(f => {
        const geometry = f.geometry
        const point = isPointGeometry(geometry) ? geometry : null
        
        // If not a point, try to get lat/lng from properties (centroids)
        const lat = point ? point.coordinates[1] : (typeof f.properties?.lat === 'number' ? f.properties.lat : 0)
        const lng = point ? point.coordinates[0] : (typeof f.properties?.lng === 'number' ? f.properties.lng : 0)

        return {
          id: f.properties?.id || Math.random(),
          datasetId: f.layer.id.split('-').pop() || '',
          lat,
          lng,
          value: typeof f.properties?.value === 'number' ? f.properties.value : undefined,
          category: typeof f.properties?.category === 'string' ? f.properties.category : undefined,
          timestamp: f.properties?.timestamp,
          metadata: (f.properties || {}) as Record<string, unknown>
        }
      })

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
    const mapInstance = map.current
    if (!mapInstance || !isLoaded || !regionFocus) return

    mapInstance.fitBounds([regionFocus.bounds.sw, regionFocus.bounds.ne], {
      padding: 72,
      duration: 900,
      maxZoom: 13,
    })
  }, [regionFocus, isLoaded])

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
