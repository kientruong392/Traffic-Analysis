// Các kiểu dữ liệu dùng chung giữa dashboard và Server Actions.
export type SourceType = "image" | "video" | "camera";

// Tọa độ chuẩn hóa từ 0 đến 1, không phụ thuộc kích thước canvas trên màn hình.
export type ROI = { x1: number; y1: number; x2: number; y2: number };
export type AnalysisOptions = { roi: ROI | null; tracking: boolean };
export type VehicleCounts = {
  car: number;
  motorcycle: number;
  bus: number;
  truck: number;
  bicycle: number;
};

export type ModelInfo = {
  name: string;
  parameters: number;
  device: string;
  input_size: number;
  confidence: number;
  classes: number[];
};

export type AnalysisResult = {
  session_id: string | null;
  image: string;
  counts: VehicleCounts;
  count_mode: "unique" | "snapshot";
  tracking: boolean;
  done: boolean;
  frame_index: number;
  total_frames: number;
  source_fps: number;
  width: number;
  height: number;
  detections: number;
  inference_ms: number;
  processing_fps: number;
  model: ModelInfo;
};

export type ActionResult<T> =
  { success: true; data: T } | { success: false; error: string };

export const EMPTY_COUNTS: VehicleCounts = {
  car: 0,
  motorcycle: 0,
  bus: 0,
  truck: 0,
  bicycle: 0,
};
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
