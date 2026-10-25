"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ScanLine } from "lucide-react";
import type { ROI } from "@/lib/traffic";

type Props = {
  image: string | null;
  roi: ROI | null;
  disabled: boolean;
  onROIChange: (roi: ROI | null) => void;
};

export function FrameCanvas({ image, roi, disabled, onROIChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<ROI | null>(null);

  // Vẽ ở độ phân giải gốc. CSS thu nhỏ canvas và giữ nguyên tỷ lệ ảnh.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) return;

    function draw(picture: HTMLImageElement) {
      if (!canvas || !context) return;
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      context.drawImage(picture, 0, 0);
      const box = draft ?? roi;
      if (!box) return;
      const x = box.x1 * canvas.width;
      const y = box.y1 * canvas.height;
      const width = (box.x2 - box.x1) * canvas.width;
      const height = (box.y2 - box.y1) * canvas.height;
      const lineWidth = Math.max(2, canvas.width / 500);
      context.fillStyle = "rgba(45, 212, 191, 0.12)";
      context.fillRect(x, y, width, height);
      context.strokeStyle = "#2dd4bf";
      context.lineWidth = lineWidth;
      context.setLineDash([lineWidth * 4, lineWidth * 2]);
      context.strokeRect(x, y, width, height);
      context.setLineDash([]);
      context.font = `${Math.max(14, canvas.width / 60)}px sans-serif`;
      context.fillStyle = "#2dd4bf";
      context.fillText("ROI", x + 8, y + Math.max(22, canvas.width / 45));
    }

    if (imageRef.current?.src === image && imageRef.current.complete) {
      draw(imageRef.current);
      return;
    }
    const picture = new window.Image();
    picture.onload = () => {
      imageRef.current = picture;
      draw(picture);
    };
    picture.src = image;
    // Không cho ảnh cũ ghi đè khi frame mới đã đến.
    return () => {
      picture.onload = null;
    };
  }, [image, roi, draft]);

  function getPoint(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  }

  function rectangle(event: PointerEvent<HTMLCanvasElement>): ROI | null {
    const start = startRef.current;
    if (!start) return null;
    const end = getPoint(event);
    return {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    };
  }

  return (
    <div className="relative flex min-h-64 items-center justify-center overflow-hidden rounded-xl bg-slate-950 lg:min-h-96">
      {image ? (
        <canvas
          ref={canvasRef}
          aria-label="Khung hình nhận diện. Kéo chuột để vẽ vùng đếm ROI; dùng nút Xóa ROI để đếm toàn khung."
          className={`block h-auto max-h-[560px] w-auto max-w-full touch-none ${disabled ? "cursor-default" : "cursor-crosshair"}`}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            startRef.current = getPoint(event);
            setDraft(null);
          }}
          onPointerMove={(event) => {
            if (startRef.current) setDraft(rectangle(event));
          }}
          onPointerUp={(event) => {
            const box = rectangle(event);
            if (box && box.x2 - box.x1 > 0.01 && box.y2 - box.y1 > 0.01)
              onROIChange(box);
            startRef.current = null;
            setDraft(null);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            startRef.current = null;
            setDraft(null);
          }}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-2xl border border-teal-400/20 bg-teal-400/10 p-5 text-teal-300">
            <ScanLine className="size-10" strokeWidth={1.25} />
          </div>
          <div>
            <p className="font-medium text-slate-100">
              Sẵn sàng quan sát giao thông
            </p>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
              Chọn ảnh, video hoặc kết nối camera bên dưới.
              <br />
              Kéo chuột trên khung hình để chọn vùng đếm.
            </p>
          </div>
          <span className="text-xs tracking-widest text-slate-500">
            YOLOv8n · OPENCV · BYTETRACK
          </span>
        </div>
      )}
    </div>
  );
}
