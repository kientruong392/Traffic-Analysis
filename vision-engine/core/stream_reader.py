"""Mở video / RTSP, xử lý từng nhóm frame và quản lý vòng đời phiên."""

import asyncio
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import BinaryIO
from urllib.parse import urlparse
from uuid import uuid4

import cv2
import numpy as np

from config import CHUNK_FRAMES, MAX_SESSIONS, MAX_UPLOAD, SESSION_TTL, UPLOAD_DIR
from core import ProcessingError
from core.detector import analyze_frame, encode_frame, model_info, processing_lock, resize_frame
from core.tracker import AnalysisOptions, VehicleTracker, empty_counts


@dataclass
class VideoSession:
    capture: cv2.VideoCapture
    options: AnalysisOptions
    camera: bool = False
    temp_path: Path | None = None
    tracker: VehicleTracker = field(default_factory=VehicleTracker)
    frame_index: int = 0
    total_frames: int = 0
    source_fps: float = 0
    pending_frame: np.ndarray | None = None
    last_result: dict = field(default_factory=dict)
    last_access: float = field(default_factory=time.monotonic)


sessions: dict[str, VideoSession] = {}


def close_session(session_id: str):
    """Gọi bên trong processing_lock để không đóng nguồn đang được đọc."""
    session = sessions.pop(session_id, None)
    if session:
        session.capture.release()
        if session.temp_path:
            session.temp_path.unlink(missing_ok=True)


def stop_session(session_id: str):
    with processing_lock:
        close_session(session_id)
    return {"stopped": True}


def close_all_sessions():
    with processing_lock:
        for session_id in list(sessions):
            close_session(session_id)


def cleanup_expired_sessions():
    with processing_lock:
        for session_id, session in list(sessions.items()):
            if time.monotonic() - session.last_access > SESSION_TTL:
                close_session(session_id)


async def cleanup_loop():
    while True:
        await asyncio.sleep(30)
        await asyncio.to_thread(cleanup_expired_sessions)


def open_session(capture, options: AnalysisOptions, temp_path=None, camera=False):
    """Tạo phiên và trả ảnh xem trước; gọi khi đã giữ processing_lock."""
    try:
        if len(sessions) >= MAX_SESSIONS:
            raise ProcessingError("Đã có 4 phiên đang mở. Hãy kết thúc một phiên rồi thử lại.", 503)
        ok, frame = capture.read() if capture.isOpened() else (False, None)
        if not ok:
            raise ProcessingError("Không mở được nguồn hoặc không đọc được frame đầu tiên.")

        fps = capture.get(cv2.CAP_PROP_FPS)
        total = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        session = VideoSession(
            capture=capture, options=options, camera=camera, temp_path=temp_path,
            source_fps=fps if math.isfinite(fps) and fps > 0 else 0,
            total_frames=int(total) if not camera and math.isfinite(total) and total > 0 else 0,
            pending_frame=frame,
        )
        session_id = uuid4().hex
        preview = resize_frame(frame)
        session.last_result = {
            "session_id": session_id, "image": encode_frame(preview), "counts": empty_counts(),
            "count_mode": "unique" if options.tracking else "snapshot", "tracking": options.tracking,
            "done": False, "frame_index": 0, "total_frames": session.total_frames,
            "source_fps": session.source_fps, "width": preview.shape[1], "height": preview.shape[0],
            "detections": 0, "inference_ms": 0, "processing_fps": 0, "model": model_info,
        }
        sessions[session_id] = session
        return session.last_result
    except Exception:
        # Kể cả lỗi lúc tạo ảnh xem trước, phải giải phóng capture / video tạm.
        capture.release()
        if temp_path:
            temp_path.unlink(missing_ok=True)
        raise


def open_video(source: BinaryIO, filename: str, options: AnalysisOptions):
    suffix = Path(filename).suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".avi"}:
        raise ProcessingError("Chỉ hỗ trợ video MP4, WebM, MOV hoặc AVI.")
    UPLOAD_DIR.mkdir(exist_ok=True)
    temp_path = None
    try:
        # Ghi từng MB để không giữ toàn bộ video upload trong RAM.
        with NamedTemporaryFile(dir=UPLOAD_DIR, suffix=suffix, delete=False) as destination:
            temp_path = Path(destination.name)
            size = 0
            while chunk := source.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise ProcessingError("Video vượt quá 50 MB.", 413)
                destination.write(chunk)
        with processing_lock:
            return open_session(cv2.VideoCapture(str(temp_path)), options, temp_path=temp_path)
    except Exception:
        if temp_path:
            temp_path.unlink(missing_ok=True)
        raise


def open_camera(url: str, options: AnalysisOptions):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"rtsp", "rtsps"} or not parsed.hostname:
            raise ValueError()
    except ValueError:
        raise ProcessingError("URL camera phải bắt đầu bằng rtsp:// hoặc rtsps://.")
    # Timeout để camera mất kết nối không treo request vô hạn.
    with processing_lock:
        capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG, [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000,
        ])
        return open_session(capture, options, camera=True)


def next_frames(session_id: str, options: AnalysisOptions):
    with processing_lock:
        session = sessions.get(session_id)
        if session is None:
            raise ProcessingError("Phiên đã kết thúc hoặc hết hạn. Vui lòng mở lại nguồn.", 404)
        session.last_access = time.monotonic()
        if session.options != options:
            # Đổi ROI / tracking: tạo bộ đếm mới nhưng giữ vị trí video hiện tại.
            session.options = options
            session.tracker = VehicleTracker()
            session.last_result = {
                **session.last_result, "counts": empty_counts(),
                "tracking": options.tracking,
                "count_mode": "unique" if options.tracking else "snapshot",
            }

        done = False
        try:
            for _ in range(CHUNK_FRAMES):
                if session.pending_frame is not None:
                    frame = session.pending_frame
                    session.pending_frame = None
                    ok = True
                else:
                    ok, frame = session.capture.read()
                if not ok:
                    if session.camera:
                        raise ProcessingError("Mất kết nối camera. Hãy kết nối lại.", 502)
                    done = True
                    break
                result = analyze_frame(frame, options, session.tracker)
                session.frame_index += 1
                session.last_result = {
                    **result, "session_id": session_id, "done": False,
                    "frame_index": session.frame_index, "total_frames": session.total_frames,
                    "source_fps": session.source_fps,
                }
            response = {**session.last_result, "done": done}
            if done:
                close_session(session_id)
            return response
        except Exception:
            close_session(session_id)
            raise
