export interface CreateSearchJobResponse {
  id: string;
  link: {
    rel: string;
    href: string;
  };
}

export interface SearchJobStatus {
  state:
    | "NOT STARTED"
    | "GATHERING RESULTS"
    | "FORCE PAUSED"
    | "DONE GATHERING RESULTS"
    | "CANCELLED";
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

export interface SearchMessagesResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  messages: Array<{ map: { [key: string]: string } }>;
}

export interface SearchRecordsResponse {
  fields: Array<{ name: string; fieldType: string; keyField: boolean }>;
  records: Array<{ map: Record<string, string> }>;
}
