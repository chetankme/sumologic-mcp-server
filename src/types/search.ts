export interface CreateSearchJobRequest {
  query: string;
  from: string;
  to: string;
  timeZone?: string;
  byReceiptTime?: boolean;
}

export interface CreateSearchJobResponse {
  id: string;
  link: {
    rel: string;
    href: string;
  };
}

export type SearchJobState =
  | "NOT STARTED"
  | "GATHERING RESULTS"
  | "FORCE PAUSED"
  | "DONE GATHERING RESULTS"
  | "CANCELLED";

export interface SearchJobStatus {
  state: SearchJobState;
  messageCount: number;
  histogramBuckets?: Array<{
    length: number;
    count: number;
    startTimestamp: number;
  }>;
  pendingErrors: string[];
  pendingWarnings: string[];
  recordCount: number;
}

export interface SearchMessageMap {
  [key: string]: string;
}

export interface SearchMessage {
  map: SearchMessageMap;
}

export interface SearchMessagesResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  messages: SearchMessage[];
}

export interface SearchRecord {
  map: Record<string, string>;
}

export interface SearchRecordsResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  records: SearchRecord[];
}

export interface TimeRangeRelative {
  type: "BeginBoundedTimeRange";
  from: {
    type: "RelativeTimeRangeBoundary";
    relativeTime: string; // e.g. "-15m", "-1h"
  };
  to?: {
    type: "RelativeTimeRangeBoundary";
    relativeTime: string;
  };
}

export interface TimeRangeAbsolute {
  type: "BeginBoundedTimeRange";
  from: {
    type: "EpochTimeRangeBoundary";
    epochMillis: number;
  };
  to?: {
    type: "EpochTimeRangeBoundary";
    epochMillis: number;
  };
}

export interface TimeRangeLiteral {
  type: "BeginBoundedTimeRange";
  from: {
    type: "LiteralTimeRangeBoundary";
    rangeName: string; // "today", "yesterday", "this_week", etc.
  };
}

export type TimeRange = TimeRangeRelative | TimeRangeAbsolute | TimeRangeLiteral;

export interface SavedLogSearch {
  id?: string;
  name: string;
  description?: string;
  queryString: string;
  timeRange: TimeRange;
  parsingMode?: "Manual" | "AutoParse";
  runByReceiptTime?: boolean;
  queryParameters?: Array<{
    name: string;
    description?: string;
    dataType: string;
    value: string;
  }>;
}

export interface SavedLogSearchListResponse {
  data: SavedLogSearch[];
  next?: string;
}
