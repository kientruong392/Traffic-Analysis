"""Nhận request từ Next.js, gọi core xử lý và trả JSON cho Server Actions."""

import asyncio
import json
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import Field

from config import MAX_UPLOAD
from core import ProcessingError, detector, stream_reader
from core.tracker import AnalysisOptions, ROI


class CameraRequest(AnalysisOptions):
    url: str = Field(min_length=8, max_length=2048)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dọn phiên hết hạn trong lúc chạy và đóng mọi nguồn khi service dừng.
    cleanup_task = asyncio.create_task(stream_reader.cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task
        stream_reader.close_all_sessions()


app = FastAPI(title="Traffic AI Service", lifespan=lifespan)


@app.exception_handler(ProcessingError)
async def processing_error_handler(request: Request, error: ProcessingError):
    # Core không phụ thuộc FastAPI; main chuyển lỗi thành JSON có dạng quen thuộc.
    return JSONResponse(status_code=error.status_code, content={"detail": str(error)})


def parse_roi(raw: str):
    try:
        value = json.loads(raw)
        return ROI.model_validate(value) if value is not None else None
    except (ValueError, TypeError):
        raise HTTPException(400, "ROI không hợp lệ. Tọa độ phải nằm từ 0 đến 1.")


@app.get("/")
def read_root():
    return {"status": "AI Service is running", "model": "YOLOv8n loaded"}


@app.get("/health")
def health():
    return detector.model_info


@app.post("/process-image")
def process_image(file: UploadFile = File(...), roi: str = Form("null")):
    try:
        data = file.file.read(MAX_UPLOAD + 1)
        return detector.analyze_image(data, parse_roi(roi))
    finally:
        file.file.close()


@app.post("/sessions/video")
def open_video(
    file: UploadFile = File(...), roi: str = Form("null"), tracking: bool = Form(True)
):
    try:
        options = AnalysisOptions(roi=parse_roi(roi), tracking=tracking)
        return stream_reader.open_video(file.file, file.filename or "video.mp4", options)
    finally:
        file.file.close()


@app.post("/sessions/camera")
def open_camera(body: CameraRequest):
    options = AnalysisOptions(roi=body.roi, tracking=body.tracking)
    return stream_reader.open_camera(body.url, options)


@app.post("/sessions/{session_id}/next")
def next_frames(session_id: str, options: AnalysisOptions):
    return stream_reader.next_frames(session_id, options)


@app.delete("/sessions/{session_id}")
def stop_session(session_id: str):
    return stream_reader.stop_session(session_id)
