export interface MetricsQueryResponse {
  response: Array<{
    rowId: string;
    results: Array<{
      metric: {
        dimensions: Array<{ key: string; value: string }>;
        [key: string]: unknown;
      };
      datapoints: {
        timestamp: number[];
        value: number[];
      };
      horAggs?: unknown;
    }>;
  }>;
  queryInfo?: unknown;
  error?: string;
  errorMessage?: string;
}
