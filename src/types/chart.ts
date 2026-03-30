export interface ChartSeries {
  label: string;
  color: string;
  timestamps: number[];
  values: number[];
}

export interface ChartData {
  title: string;
  series: ChartSeries[];
  width: number;
  height: number;
}

export interface BarChartItem {
  label: string;
  value: number;
  color: string;
}

export interface BarChartData {
  title: string;
  items: BarChartItem[];
  valueLabel: string;
  width: number;
  height: number;
}
