export interface DashboardQuery {
  queryString: string;
  queryType: string; // "Logs" | "Metrics" | "Traces"
  queryKey: string;  // e.g. "A", "B", "C"
  metricsQueryMode?: string | null;
  parseMode?: string;
  timeSource?: string;
  outputCardinalityLimit?: number;
}

export interface DashboardPanel {
  id: string;
  key: string;
  title: string;
  panelType: string; // e.g. "SumoSearchPanel", "TextPanel"
  queries?: DashboardQuery[];
  description?: string;
  visualSettings?: string; // JSON string
  timeRange?: unknown;
  coloringRules?: unknown;
  linkedDashboards?: unknown[];
}

export interface DashboardVariable {
  id: string;
  name: string;
  displayName?: string;
  defaultValue?: string;
  sourceDefinition?: unknown;
  allowMultiSelect?: boolean;
  includeAllOption?: boolean;
  hideFromUI?: boolean;
}

export interface LayoutStructure {
  key: string;
  structure: string; // JSON string with height, width, x, y
}

export interface DashboardLayout {
  layoutType: string;
  layoutStructures: LayoutStructure[];
}

export interface Dashboard {
  id: string;
  contentId?: string | null;
  scheduleId?: string | null;
  scheduleCount?: number;
  title: string;
  description?: string;
  folderId?: string;
  domain?: string;
  refreshInterval?: number;
  timeRange?: unknown;
  panels?: DashboardPanel[];
  layout?: DashboardLayout;
  variables?: DashboardVariable[];
  theme?: string;
  isPublic?: boolean;
  highlightViolations?: boolean;
}

export interface PaginatedDashboards {
  dashboards: Dashboard[];
  next: string | null;
}
