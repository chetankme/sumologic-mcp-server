export interface MetricsQueryRow {
  rowId: string;
  query: string;
}

export interface MetricsQueryRequest {
  queries: MetricsQueryRow[];
  timeRange: {
    type: "BeginBoundedTimeRange";
    from: {
      type: "RelativeTimeRangeBoundary" | "EpochTimeRangeBoundary";
      relativeTime?: string;
      epochMillis?: number;
    };
    to?: {
      type: "RelativeTimeRangeBoundary" | "EpochTimeRangeBoundary";
      relativeTime?: string;
      epochMillis?: number;
    };
  };
}

export interface MetricsDataPoint {
  timestamp: number;
  value: number;
}

export interface MetricsTimeSeries {
  rowId: string;
  dimensions: Record<string, string>;
  datapoints: MetricsDataPoint[];
}

export interface MetricsQueryResult {
  rowId: string;
  results: MetricsTimeSeries[];
}

export interface MetricsQueryResponse {
  queryResult: MetricsQueryResult[];
  errors?: Array<{
    rowId: string;
    errors: Array<{ code: string; message: string }>;
  }>;
}

export interface SavedMetricsSearch {
  id?: string;
  title: string;
  description: string;
  timeRange: MetricsQueryRequest["timeRange"];
  logQuery?: string;
  metricsQueries: MetricsQueryRow[];
  desiredQuantizationInSecs?: number;
}

export interface SavedMetricsSearchListResponse {
  metricsSearches: SavedMetricsSearch[];
  token?: string;
}
