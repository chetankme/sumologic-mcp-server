export interface MetricsQueryResponse {
  queryResult: Array<{
    rowId: string;
    results: Array<{
      rowId: string;
      dimensions: Record<string, string>;
      datapoints: Array<{
        timestamp: number;
        value: number;
      }>;
    }>;
  }>;
  errors?: Array<{
    rowId: string;
    errors: Array<{ code: string; message: string }>;
  }>;
}
