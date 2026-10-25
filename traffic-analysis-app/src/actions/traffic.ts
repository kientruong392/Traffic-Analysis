"use server";

import {
  MAX_UPLOAD_BYTES,
  type ActionResult,
  type AnalysisOptions,
  type AnalysisResult,
  type ModelInfo,
} from "@/lib/traffic";

// Chỉ server đọc biến này. Không dùng NEXT_PUBLIC_ vì client không gọi Python.
const AI_SERVICE_URL = (
  process.env.AI_SERVICE_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

function checkOptions(options: AnalysisOptions) {
  if (!options || typeof options.tracking !== "boolean")
    throw new Error("Cấu hình tracking không hợp lệ.");
  if (options.roi === null) return;
  const box = options.roi;
  if (
    !box ||
    ![box.x1, box.y1, box.x2, box.y2].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    box.x1 >= box.x2 ||
    box.y1 >= box.y2
  ) {
    throw new Error("ROI không hợp lệ. Hãy vẽ lại vùng đếm.");
  }
}

function readOptions(form: FormData): AnalysisOptions {
  const options = {
    roi: JSON.parse(String(form.get("roi") ?? "null")),
    tracking: form.get("tracking") === "true",
  };
  checkOptions(options);
  return options;
}

function readFile(form: FormData, kind: "image" | "video") {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    throw new Error("Vui lòng chọn file cần xử lý.");
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("File vượt quá giới hạn 50 MB.");
  const allowed =
    kind === "image"
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
  if (!allowed.includes(file.type))
    throw new Error("Định dạng file chưa được hỗ trợ.");
  return file;
}

function checkSessionId(id: string) {
  if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id))
    throw new Error("Mã phiên xử lý không hợp lệ.");
}

function failure(cause: unknown): { success: false; error: string } {
  return {
    success: false,
    error: cause instanceof Error ? cause.message : "Dữ liệu không hợp lệ.",
  };
}

// Toàn bộ fetch tới FastAPI nằm trong file 'use server' này.
async function callAI<T>(
  path: string,
  init?: RequestInit,
): Promise<ActionResult<T>> {
  try {
    const response = await fetch(`${AI_SERVICE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const data = await response.json();
    if (!response.ok) {
      return {
        success: false,
        error:
          typeof data.detail === "string"
            ? data.detail
            : "AI Service từ chối dữ liệu. Kiểm tra file, URL hoặc ROI.",
      };
    }
    return { success: true, data: data as T };
  } catch {
    return {
      success: false,
      error:
        "Không nhận được phản hồi từ AI Service. Hãy chạy FastAPI tại cổng 8000 và thử lại.",
    };
  }
}

export async function getServiceStatusAction(): Promise<
  ActionResult<ModelInfo>
> {
  return callAI<ModelInfo>("/health");
}

export async function processImageAction(
  form: FormData,
): Promise<ActionResult<AnalysisResult>> {
  try {
    const options = readOptions(form);
    const body = new FormData();
    body.set("file", readFile(form, "image"));
    body.set("roi", JSON.stringify(options.roi));
    return await callAI<AnalysisResult>("/process-image", {
      method: "POST",
      body,
    });
  } catch (cause) {
    return failure(cause);
  }
}

export async function openSourceAction(
  form: FormData,
): Promise<ActionResult<AnalysisResult>> {
  try {
    const options = readOptions(form);
    if (form.get("source") === "camera") {
      const url = String(form.get("url") ?? "").trim();
      const parsed = URL.canParse(url) ? new URL(url) : null;
      if (!parsed || !["rtsp:", "rtsps:"].includes(parsed.protocol) || !parsed.hostname)
        throw new Error("Vui lòng nhập URL rtsp:// hoặc rtsps:// hợp lệ.");
      return await callAI<AnalysisResult>("/sessions/camera", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...options }),
      });
    }
    if (form.get("source") !== "video")
      throw new Error("Nguồn dữ liệu không hợp lệ.");
    // Chỉ upload video một lần. Các action tiếp theo gửi mã phiên để đọc tiếp.
    const body = new FormData();
    body.set("file", readFile(form, "video"));
    body.set("roi", JSON.stringify(options.roi));
    body.set("tracking", String(options.tracking));
    return await callAI<AnalysisResult>("/sessions/video", {
      method: "POST",
      body,
    });
  } catch (cause) {
    return failure(cause);
  }
}

export async function processVideoChunkAction(
  id: string,
  options: AnalysisOptions,
): Promise<ActionResult<AnalysisResult>> {
  try {
    checkSessionId(id);
    checkOptions(options);
    return await callAI<AnalysisResult>(`/sessions/${id}/next`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
  } catch (cause) {
    return failure(cause);
  }
}

export async function stopSessionAction(
  id: string,
): Promise<ActionResult<{ stopped: boolean }>> {
  try {
    checkSessionId(id);
    return await callAI<{ stopped: boolean }>(`/sessions/${id}`, {
      method: "DELETE",
    });
  } catch (cause) {
    return failure(cause);
  }
}
