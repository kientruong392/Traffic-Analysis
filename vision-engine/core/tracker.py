"""Kiểm tra ROI, gán ID bằng ByteTrack và đếm phương tiện."""

from dataclasses import dataclass, field

import cv2
from pydantic import BaseModel, Field, model_validator

# Import config trước Ultralytics để YOLO_CONFIG_DIR có hiệu lực.
from config import VEHICLE_CLASSES
from ultralytics.trackers.byte_tracker import BYTETracker
from ultralytics.utils import ROOT, YAML, IterableSimpleNamespace


class ROI(BaseModel):
    """Hình chữ nhật dùng tọa độ chuẩn hóa từ 0 đến 1."""

    x1: float = Field(ge=0, le=1)
    y1: float = Field(ge=0, le=1)
    x2: float = Field(ge=0, le=1)
    y2: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def check_rectangle(self):
        if self.x1 >= self.x2 or self.y1 >= self.y2:
            raise ValueError("ROI phải có chiều rộng và chiều cao lớn hơn 0.")
        return self


class AnalysisOptions(BaseModel):
    roi: ROI | None = None
    tracking: bool = True


def empty_counts():
    return {name: 0 for name in VEHICLE_CLASSES.values()}


tracker_args = YAML.load(ROOT / "cfg" / "trackers" / "bytetrack.yaml")


def new_tracker():
    return BYTETracker(IterableSimpleNamespace(**tracker_args))


@dataclass
class VehicleTracker:
    """Mỗi nguồn giữ một bộ ID và bộ đếm riêng, không dùng chung giữa các phiên."""

    byte_tracker: BYTETracker = field(default_factory=new_tracker)
    counts: dict[str, int] = field(default_factory=empty_counts)
    counted_ids: set[int] = field(default_factory=set)
    previous_centers: dict[int, tuple[int, int]] = field(default_factory=dict)


def pixel_roi(roi: ROI | None, width: int, height: int):
    if roi is None:
        return (0, 0, width - 1, height - 1)
    return (
        int(roi.x1 * (width - 1)), int(roi.y1 * (height - 1)),
        int(roi.x2 * (width - 1)), int(roi.y2 * (height - 1)),
    )


def center_crosses_roi(center, previous, rectangle):
    left, top, right, bottom = rectangle
    if left <= center[0] <= right and top <= center[1] <= bottom:
        return True
    # Xe nhanh có thể đi qua cả ROI giữa hai frame: xét đoạn nối hai tâm.
    if previous is not None:
        return cv2.clipLine(
            (left, top, right - left + 1, bottom - top + 1), previous, center
        )[0]
    return False


def track_and_count(boxes, frame, options: AnalysisOptions, state: VehicleTracker | None = None):
    """Trả danh sách xe để detector vẽ và thống kê để frontend hiển thị."""
    height, width = frame.shape[:2]
    rectangle = pixel_roi(options.roi, width, height)
    use_tracking = state is not None and options.tracking
    counts = state.counts if use_tracking else empty_counts()

    if use_tracking:
        # Giữ tracker qua các request và đưa mọi frame liên tiếp vào ByteTrack.
        objects = state.byte_tracker.update(boxes, frame)
    else:
        # Chung định dạng: x1, y1, x2, y2, id, confidence, class.
        objects = [(*box.xyxy[0], -1, float(box.conf[0]), int(box.cls[0])) for box in boxes]

    vehicles = []
    for item in objects:
        x1, y1, x2, y2 = map(int, item[:4])
        track_id, score, class_id = int(item[4]), float(item[5]), int(item[6])
        if class_id not in VEHICLE_CLASSES:
            continue
        center = ((x1 + x2) // 2, (y1 + y2) // 2)
        previous = state.previous_centers.get(track_id) if use_tracking else None
        in_roi = center_crosses_roi(center, previous, rectangle)

        if use_tracking:
            if in_roi and track_id not in state.counted_ids:
                counts[VEHICLE_CLASSES[class_id]] += 1
                state.counted_ids.add(track_id)
            state.previous_centers[track_id] = center
        elif in_roi:
            counts[VEHICLE_CLASSES[class_id]] += 1

        vehicles.append({
            "box": (x1, y1, x2, y2), "center": center,
            "track_id": track_id if use_tracking else None,
            "score": score, "class_id": class_id, "in_roi": in_roi,
        })

    return vehicles, counts.copy()
