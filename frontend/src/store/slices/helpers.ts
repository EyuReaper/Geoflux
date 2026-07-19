import { Parser } from 'expr-eval'
import type { DataPoint, FieldMapping, Transformation, Dataset } from '../../types/index'

export const expressionParser = new Parser({
  operators: {
    add: true,
    concatenate: false,
    conditional: true,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: true,
    comparison: true,
    in: false,
    assignment: false,
  },
})

export const LOCAL_DATASET_PREFIX = 'local-'

export const defaultMapping: FieldMapping = {
  lat: '',
  lng: '',
  value: '',
  category: '',
  timestamp: '',
}

export const isLocalDatasetId = (id: string) => id.startsWith(LOCAL_DATASET_PREFIX)

export const toTimestampValue = (value: unknown) => value as DataPoint['timestamp']

export const runValueTransformation = (
  value: number,
  row: Record<string, unknown>,
  expression: string,
): number => {
  try {
    const expr = expressionParser.parse(expression)
    const scope: Record<string, number | string | boolean> = { value }
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
        scope[key] = val
      }
    }
    const result = expr.evaluate(scope as never)
    return typeof result === 'number' && !Number.isNaN(result) ? result : value
  } catch {
    return value
  }
}

export const buildMappedData = (
  rawData: Record<string, unknown>[],
  fieldMapping: FieldMapping,
  transformations: Transformation[],
  datasetId: string,
): DataPoint[] =>
  rawData.map((d, i) => {
    let value = fieldMapping.value ? Number(d[fieldMapping.value] || 0) : 1
    transformations
      .filter((t) => t.active)
      .forEach((t) => {
        value = runValueTransformation(value, d, t.expression)
      })
    return {
      id: `${datasetId}-${i}`,
      datasetId,
      lat: Number(d[fieldMapping.lat] || 0),
      lng: Number(d[fieldMapping.lng] || 0),
      value,
      category: fieldMapping.category ? String(d[fieldMapping.category]) : 'default',
      timestamp: fieldMapping.timestamp ? toTimestampValue(d[fieldMapping.timestamp]) : undefined,
      metadata: d,
    }
  })

export const buildDatasetStats = (data: DataPoint[]): Dataset['stats'] => {
  const categories = new Set<string>()
  let min = Infinity
  let max = -Infinity

  data.forEach((point) => {
    const value = point.value || 0
    min = Math.min(min, value)
    max = Math.max(max, value)
    if (point.category) categories.add(point.category)
  })

  return {
    count: data.length,
    categories: Array.from(categories),
    min: min === Infinity ? 0 : min,
    max: max === -Infinity ? 0 : max,
  }
}
