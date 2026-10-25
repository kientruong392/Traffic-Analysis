"""Nạp YOLO, nhận diện phương tiện, vẽ kết quả và mã hóa ảnh Base64."""

import base64
import time
from threading import Lock

import cv2
import numpy as np
import torch

from config import (
    COLORS, CONFIDENCE, INPUT_SIZE, JPEG_QUALITY, MAX_FRAME_SIZE,
    MAX_UPLOAD, MODEL_PATH, VEHICLE_CLASSES,
)
from core import ProcessingError
from core.tracker import AnalysisOptions, ROI, VehicleTracker, track_and_count
from ultralytics import YOLO

# Nạp trọng số một lần khi service khởi động; các phiên dùng chung model này.
device = "cuda:0" if torch.cuda.is_available() else "cpu"
model = YOLO(str(MODEL_PATH))
model.to(device)
model_info = {
    "name": "YOLOv8n",
    "parameters": sum(parameter.numel() for parameter in model.model.parameters()),
    "device": device,
    "input_size": INPUT_SIZE,
    "confidence": CONFIDENCE,
    "classes": list(VEHICLE_CLASSES),
}

# Ảnh và video cùng dùng khóa này để không chạy đồng thời trên một model.
processing_lock = Lock()


def encode_frame(frame):
    ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
    if not ok:
        raise ProcessingError("Không mã hóa được khung hình.", 500)
    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode("ascii")


def resize_frame(frame):
    # Giữ nguyên tỷ lệ ảnh, giới hạn cạnh dài để Base64 không quá lớn.
    height, width = frame.shape[:2]
    scale = min(1, MAX_FRAME_SIZE / max(width, height))
    if scale < 1:
        frame = cv2.resize(
            frame, (max(1, round(width * scale)), max(1, round(height * scale)))
        )
    return frame


def analyze_frame(frame, options: AnalysisOptions, tracker: VehicleTracker | None = None):
    """Hàm dùng chung cho ảnh, frame video và frame camera."""
    started = time.perf_counter()
    frame = resize_frame(frame)
    height, width = frame.shape[:2]
    prediction = model.predict(
        frame, classes=list(VEHICLE_CLASSES), conf=CONFIDENCE,
        imgsz=INPUT_SIZE, device=device, verbose=False,
    )[0]
    boxes = prediction.boxes.cpu().numpy()
    vehicles, counts = track_and_count(boxes, frame, options, tracker)
    use_tracking = tracker is not None and options.tracking

    for vehicle in vehicles:
        x1, y1, x2, y2 = vehicle["box"]
        class_id = vehicle["class_id"]
        color = COLORS[class_id]
        label = f"{VEHICLE_CLASSES[class_id]} {vehicle['score']:.0%}"
        if vehicle["track_id"] is not None:
            label = f"#{vehicle['track_id']} {label}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        center_color = (0, 255, 180) if vehicle["in_roi"] else color
        cv2.circle(frame, vehicle["center"], 4, center_color, -1)
        # Font mặc định của OpenCV không hỗ trợ tiếng Việt nên dùng tên COCO.
        cv2.putText(
            frame, label, (max(0, x1), max(18, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2,
        )

    # ROI do canvas vẽ để có thể xóa / thay đổi khi tạm dừng.
    elapsed = time.perf_counter() - started
    return {
        "image": encode_frame(frame), "counts": counts,
        "count_mode": "unique" if use_tracking else "snapshot", "tracking": use_tracking,
        "width": width, "height": height, "detections": len(boxes),
        "inference_ms": round(prediction.speed["inference"], 2),
        "processing_fps": round(1 / max(elapsed, 0.000001), 2), "model": model_info,
    }


def analyze_image(data: bytes, roi: ROI | None):
    if len(data) > MAX_UPLOAD:
        raise ProcessingError("Ảnh vượt quá 50 MB.", 413)
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR) if data else None
    if frame is None:
        raise ProcessingError("File không phải ảnh hợp lệ hoặc ảnh đã hỏng.")
    with processing_lock:
        result = analyze_frame(frame, AnalysisOptions(roi=roi, tracking=False))
    return {
        **result, "session_id": None, "done": True,
        "frame_index": 1, "total_frames": 1, "source_fps": 0,
    }
