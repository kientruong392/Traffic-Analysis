"""Các tham số chung của AI Service; thay đổi tại đây để thử nghiệm mô hình."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
# Đặt trước khi import Ultralytics để cấu hình được lưu trong thư mục dự án.
os.environ.setdefault("YOLO_CONFIG_DIR", str(BASE_DIR / ".ultralytics"))

MODEL_PATH = BASE_DIR / "yolov8n.pt"
UPLOAD_DIR = BASE_DIR / "temp_uploads"
MAX_UPLOAD = 50 * 1024 * 1024
CHUNK_FRAMES = 4
SESSION_TTL = 15 * 60
MAX_SESSIONS = 4
INPUT_SIZE = 640
CONFIDENCE = 0.25
MAX_FRAME_SIZE = 1280
JPEG_QUALITY = 82

# Mã lớp theo bộ dữ liệu COCO và màu bounding box theo thứ tự BGR của OpenCV.
VEHICLE_CLASSES = {1: "bicycle", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
COLORS = {
    1: (180, 100, 230),
    2: (235, 140, 60),
    3: (170, 190, 30),
    5: (40, 180, 240),
    7: (220, 120, 160),
}
