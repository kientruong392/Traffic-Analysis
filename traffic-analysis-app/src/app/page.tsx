"use client";

import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Activity,
  ArrowUpRight,
  Bike,
  Bus,
  Camera,
  Car,
  CheckCircle2,
  CircleHelp,
  Cpu,
  ImagePlus,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ScanLine,
  Square,
  Truck,
  Video,
  X,
} from "lucide-react";
import { FrameCanvas } from "@/components/frame-canvas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getServiceStatusAction,
  openSourceAction,
  processImageAction,
  processVideoChunkAction,
  stopSessionAction,
} from "@/actions/traffic";
import {
  EMPTY_COUNTS,
  MAX_UPLOAD_BYTES,
  type AnalysisResult,
  type ModelInfo,
  type ROI,
  type SourceType,
} from "@/lib/traffic";

const vehicles = [
  {
    key: "car",
    label: "Ô tô",
    icon: Car,
    color: "bg-blue-50 text-blue-600",
    classId: 2,
  },
  {
    key: "motorcycle",
    label: "Xe máy",
    icon: Bike,
    color: "bg-teal-50 text-teal-700",
    classId: 3,
  },
  {
    key: "bus",
    label: "Xe buýt",
    icon: Bus,
    color: "bg-amber-50 text-amber-600",
    classId: 5,
  },
  {
    key: "truck",
    label: "Xe tải",
    icon: Truck,
    color: "bg-violet-50 text-violet-600",
    classId: 7,
  },
  {
    key: "bicycle",
    label: "Xe đạp",
    icon: Bike,
    color: "bg-rose-50 text-rose-600",
    classId: 1,
  },
] as const;

export default function Home() {
  const [source, setSource] = useState<SourceType>("image");
  const [file, setFile] = useState<File | null>(null);
  const [cameraUrl, setCameraUrl] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [roi, setROI] = useState<ROI | null>(null);
  const [tracking, setTracking] = useState(true);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [framePending, setFramePending] = useState(false);
  const [isPending, runAction] = useTransition();
  const previewUrl = useRef<string | null>(null);
  const selection = useRef(0);
  const activeSession = useRef<string | null>(null);

  // Đây cũng là Server Action; trình duyệt không gọi trực tiếp FastAPI.
  useEffect(() => {
    let active = true;
    startTransition(async () => {
      try {
        const response = await getServiceStatusAction();
        if (!active) return;
        setConnected(response.success);
        if (response.success) setModel(response.data);
      } catch {
        if (active) setConnected(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      selection.current += 1;
    },
    [],
  );

  // Chờ mỗi action hoàn tất rồi mới lấy nhóm frame tiếp theo, không dùng setInterval.
  useEffect(() => {
    if (!sessionId || !running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function nextChunk() {
      setFramePending(true);
      startTransition(async () => {
        try {
          const response = await processVideoChunkAction(sessionId!, {
            roi,
            tracking,
          });
          // Khi tạm dừng, vẫn nhận nốt frame đang xử lý để không bỏ mất EOF.
          if (activeSession.current !== sessionId) return;
          if (!response.success) throw new Error(response.error);
          setResult(response.data);
          setImage(response.data.image);
          setModel(response.data.model);
          setConnected(true);
          if (response.data.done) {
            activeSession.current = null;
            setRunning(false);
            setSessionId(null);
          } else if (!cancelled) {
            timer = setTimeout(nextChunk, 60);
          }
        } catch (cause) {
          if (activeSession.current !== sessionId) return;
          setError(
            cause instanceof Error
              ? cause.message
              : "Không đọc được khung hình.",
          );
          setRunning(false);
          activeSession.current = null;
          setSessionId(null);
          await stopSessionAction(sessionId!);
        } finally {
          setFramePending(false);
        }
      });
    }

    timer = setTimeout(nextChunk, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, running, roi, tracking]);

  function changeROI(box: ROI | null) {
    setROI(box);
    // Thay vùng đếm là bắt đầu thống kê mới, không trộn kết quả hai ROI.
    setResult((previous) =>
      previous ? { ...previous, counts: EMPTY_COUNTS } : null,
    );
  }

  function changeSource(value: string) {
    selection.current += 1;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setSource(value as SourceType);
    setFile(null);
    setImage(null);
    setROI(null);
    setResult(null);
    setError(null);
  }

  function chooseFile(selected: File | undefined) {
    if (!selected) return;
    const currentSelection = ++selection.current;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setFile(null);
    setImage(null);
    setResult(null);
    setROI(null);
    setError(null);
    if (selected.size > MAX_UPLOAD_BYTES) {
      setError("Vui lòng chọn file tối đa 50 MB.");
      return;
    }
    const allowed =
      source === "image"
        ? ["image/jpeg", "image/png", "image/webp"]
        : ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];
    if (!allowed.includes(selected.type)) {
      setError(
        "Định dạng chưa hỗ trợ. Chọn JPG/PNG/WebP hoặc MP4/WebM/MOV/AVI.",
      );
      return;
    }
    const url = URL.createObjectURL(selected);
    previewUrl.current = url;
    setFile(selected);

    if (source === "image") {
      setImage(url);
      return;
    }
    // Video mở cục bộ chỉ để lấy ảnh xem trước; không gửi API từ client.
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    function releaseVideo() {
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    }
    video.onloadeddata = () => {
      if (selection.current === currentSelection) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")?.drawImage(video, 0, 0);
        setImage(canvas.toDataURL("image/jpeg"));
      }
      releaseVideo();
    };
    video.onerror = () => {
      if (selection.current === currentSelection)
        setError(
          "Trình duyệt không xem trước được video này. Bạn vẫn có thể bắt đầu và tạm dừng để vẽ ROI.",
        );
      releaseVideo();
    };
    video.src = url;
  }

  function startAnalysis() {
    setError(null);
    if (sessionId) {
      setRunning(true);
      return;
    }
    runAction(async () => {
      try {
        selection.current += 1;
        const form = new FormData();
        if (file) form.set("file", file);
        form.set("source", source);
        form.set("url", cameraUrl);
        form.set("roi", JSON.stringify(roi));
        form.set("tracking", String(tracking));
        const response =
          source === "image"
            ? await processImageAction(form)
            : await openSourceAction(form);
        if (!response.success) throw new Error(response.error);
        setResult(response.data);
        setImage(response.data.image);
        setModel(response.data.model);
        setConnected(true);
        activeSession.current = response.data.session_id;
        setSessionId(response.data.session_id);
        // Camera dừng ở ảnh xem trước để chọn ROI trước khi đếm.
        setRunning(source === "video" && !response.data.done);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Không thể xử lý. Kiểm tra AI Service và thử lại.",
        );
      }
    });
  }

  function stopAnalysis() {
    activeSession.current = null;
    setRunning(false);
    runAction(async () => {
      if (sessionId) {
        const response = await stopSessionAction(sessionId);
        if (!response.success) setError(response.error);
      }
      setSessionId(null);
    });
  }

  const counts = result?.counts ?? EMPTY_COUNTS;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const locked = running || isPending || framePending;
  const uniqueMode = source !== "image" && tracking;
  const progress = result?.total_frames
    ? Math.min(100, (result.frame_index / result.total_frames) * 100)
    : 0;
  const canStart = source === "camera" ? cameraUrl.trim().length > 0 : !!file;

  return (
    <div className="min-h-screen bg-slate-50/80">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-5 md:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-teal-700 p-2.5 text-white">
              <ScanLine className="size-6" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Traffic Vision</p>
              <p className="text-xs text-muted-foreground">
                Phân loại phương tiện giao thông
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-2 px-3 py-1.5">
            <span
              className={`size-2 rounded-full ${connected === null ? "bg-amber-400" : connected ? "bg-teal-500" : "bg-slate-400"}`}
            />
            {connected === null
              ? "Đang kiểm tra AI"
              : connected
                ? "AI Service sẵn sàng"
                : "Chưa kết nối AI"}
          </Badge>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-7 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.2em] text-teal-700">
              Bảng điều khiển
            </p>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Quan sát. Nhận diện. Thống kê.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ứng dụng mô hình YOLO vào phân loại phương tiện giao thông.
            </p>
          </div>
          <Badge variant="secondary" className="gap-1.5">
            <Cpu className="size-3.5" /> YOLOv8 nano
          </Badge>
        </div>
        {error && (
          <Alert variant="destructive">
            <CircleHelp />
            <AlertTitle>Chưa thể hoàn tất thao tác</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Video className="size-4 text-teal-700" /> Khung hình giám
                    sát
                  </CardTitle>
                  <CardDescription className="mt-1.5 max-w-lg truncate">
                    {source === "camera"
                      ? "Nguồn camera RTSP"
                      : (file?.name ?? "Chưa chọn nguồn dữ liệu")}
                  </CardDescription>
                </div>
                <Badge
                  variant={running ? "default" : "secondary"}
                  className={running ? "bg-teal-700" : ""}
                >
                  {running
                    ? "Đang phân tích"
                    : isPending
                      ? "Đang xử lý…"
                      : sessionId
                        ? "Tạm dừng / Xem trước"
                        : result?.done
                          ? "Đã hoàn tất"
                          : "Chờ nguồn dữ liệu"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <FrameCanvas
                  image={image}
                  roi={roi}
                  disabled={locked}
                  onROIChange={changeROI}
                />
                {source === "video" && result && (
                  <div className="space-y-2">
                    <Progress
                      value={progress}
                      aria-label="Tiến độ xử lý video"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Frame {result.frame_index} /{" "}
                        {result.total_frames || "—"}
                      </span>
                      <span>{progress.toFixed(0)}%</span>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-sm bg-teal-400" />
                    {roi
                      ? `ROI: (${(roi.x1 * 100).toFixed(0)}%, ${(roi.y1 * 100).toFixed(0)}%) → (${(roi.x2 * 100).toFixed(0)}%, ${(roi.y2 * 100).toFixed(0)}%)`
                      : "Vùng đếm: toàn bộ khung hình"}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!roi || locked}
                          onClick={() => changeROI(null)}
                        />
                      }
                    >
                      <X /> Xóa ROI
                    </TooltipTrigger>
                    <TooltipContent>Đếm trên toàn khung hình</TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {running
                    ? "Tạm dừng để vẽ lại ROI hoặc thay đổi tracking."
                    : "Kéo chuột theo hướng bất kỳ để vẽ ROI. Đổi ROI hoặc tracking sẽ bắt đầu lại bộ đếm."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nguồn dữ liệu & điều khiển</CardTitle>
                <CardDescription>
                  Chọn một nguồn, đặt vùng đếm và bắt đầu phân tích.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Tabs value={source} onValueChange={changeSource}>
                  <TabsList className="mb-4 w-full sm:w-auto">
                    <TabsTrigger value="image" disabled={locked || !!sessionId}>
                      <ImagePlus /> Upload Ảnh
                    </TabsTrigger>
                    <TabsTrigger value="video" disabled={locked || !!sessionId}>
                      <Video /> Upload Video
                    </TabsTrigger>
                    <TabsTrigger
                      value="camera"
                      disabled={locked || !!sessionId}
                    >
                      <Camera /> Camera RTSP
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="image">
                    <Label htmlFor="image-file">Ảnh giao thông</Label>
                    <Input
                      id="image-file"
                      className="mt-2"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={locked || !!sessionId}
                      onChange={(event) => chooseFile(event.target.files?.[0])}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      JPG, PNG, WebP · Tối đa 50 MB · Đếm xe hiện diện trong ảnh
                    </p>
                  </TabsContent>
                  <TabsContent value="video">
                    <Label htmlFor="video-file">Video giao thông</Label>
                    <Input
                      id="video-file"
                      className="mt-2"
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                      disabled={locked || !!sessionId}
                      onChange={(event) => chooseFile(event.target.files?.[0])}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      MP4, WebM, MOV, AVI · Tối đa 50 MB · Xử lý lần lượt từng
                      frame
                    </p>
                  </TabsContent>
                  <TabsContent value="camera">
                    <Label htmlFor="camera-url">URL Camera RTSP</Label>
                    <Input
                      id="camera-url"
                      className="mt-2"
                      placeholder="rtsp://192.168.1.10:554/stream"
                      value={cameraUrl}
                      disabled={locked || !!sessionId}
                      onChange={(event) => setCameraUrl(event.target.value)}
                      autoComplete="off"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Kết nối để xem trước, vẽ ROI, sau đó nhấn Bắt đầu.
                    </p>
                  </TabsContent>
                </Tabs>
                <Separator />
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="tracking"
                      checked={tracking}
                      disabled={locked || source === "image"}
                      onCheckedChange={(checked) => {
                        setTracking(checked);
                        setResult((previous) =>
                          previous
                            ? { ...previous, counts: EMPTY_COUNTS }
                            : null,
                        );
                      }}
                    />
                    <div>
                      <Label htmlFor="tracking">Tracking với ByteTrack</Label>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {source === "image"
                          ? "Áp dụng cho video và camera"
                          : tracking
                            ? "Gán ID · Mỗi xe chỉ đếm một lần"
                            : "Đếm xe hiện diện ở frame hiện tại"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {sessionId && (
                      <Button
                        variant="outline"
                        disabled={isPending}
                        onClick={stopAnalysis}
                      >
                        <Square /> Kết thúc
                      </Button>
                    )}
                    {running ? (
                      <Button
                        variant="secondary"
                        onClick={() => setRunning(false)}
                      >
                        <Pause /> Tạm dừng
                      </Button>
                    ) : (
                      <Button
                        className="bg-teal-700 text-white hover:bg-teal-800"
                        disabled={!canStart || isPending || framePending}
                        onClick={startAnalysis}
                      >
                        {isPending || framePending ? (
                          <Loader2 className="animate-spin" />
                        ) : result?.done ? (
                          <RotateCcw />
                        ) : (
                          <Play />
                        )}
                        {isPending || framePending
                          ? "Đang xử lý…"
                          : sessionId
                            ? "Bắt đầu / Tiếp tục"
                            : source === "camera"
                              ? "Kết nối camera"
                              : result?.done
                                ? "Phân tích lại"
                                : "Bắt đầu phân tích"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside
            className="space-y-5"
            aria-label="Thống kê phương tiện và thông số mô hình"
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Thống kê phương tiện{" "}
                  <Activity className="size-4 text-muted-foreground" />
                </CardTitle>
                <CardDescription>
                  {uniqueMode
                    ? "Số xe đã đi qua vùng đếm"
                    : "Số xe hiện diện trong vùng đếm"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-5 rounded-xl bg-teal-50 p-4">
                  <p className="text-xs font-medium text-teal-800">
                    TỔNG PHƯƠNG TIỆN
                  </p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <strong className="text-4xl font-semibold tabular-nums tracking-tight text-teal-950">
                      {total}
                    </strong>
                    <span className="text-sm text-teal-700">xe</span>
                  </div>
                </div>
                <div className="space-y-4">
                  {vehicles.map(
                    ({ key, label, icon: Icon, color, classId }) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className={`rounded-lg p-2 ${color}`}>
                          <Icon className="size-5" />
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-[11px] text-muted-foreground">
                            COCO class {classId}
                          </p>
                        </div>
                        <strong className="text-xl font-semibold tabular-nums">
                          {counts[key]}
                        </strong>
                      </div>
                    ),
                  )}
                </div>
                <Separator className="my-5" />
                <p className="flex gap-2 text-xs leading-5 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-teal-600" />
                  {uniqueMode
                    ? "Một ID chỉ được cộng một lần, kể cả khi xe đi vào ROI nhiều lần."
                    : "Không cộng dồn qua các frame khi tắt tracking."}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="size-4" /> Thông số mô hình
                </CardTitle>
                <CardDescription>Dữ liệu thực từ AI Service</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["Mô hình", model?.name ?? "—"],
                  [
                    "Số tham số",
                    model
                      ? `${(model.parameters / 1_000_000).toFixed(2)} M`
                      : "—",
                  ],
                  ["Thiết bị", model?.device.toUpperCase() ?? "—"],
                  ["Đầu vào YOLO", model ? `${model.input_size} px` : "—"],
                  [
                    "Ngưỡng tin cậy",
                    model ? `${model.confidence * 100}%` : "—",
                  ],
                  [
                    "Tracker",
                    source !== "image" && tracking ? "ByteTrack" : "Tắt",
                  ],
                  [
                    "Độ phân giải",
                    result ? `${result.width} × ${result.height}` : "—",
                  ],
                  [
                    "Thời gian YOLO",
                    result?.inference_ms
                      ? `${result.inference_ms.toFixed(1)} ms`
                      : "—",
                  ],
                  [
                    "Tốc độ xử lý AI",
                    result?.processing_fps
                      ? `${result.processing_fps.toFixed(1)} FPS`
                      : "—",
                  ],
                  [
                    "FPS nguồn",
                    result?.source_fps ? result.source_fps.toFixed(1) : "—",
                  ],
                  [
                    "Xe nhận diện / frame",
                    result ? String(result.detections) : "—",
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right font-medium tabular-nums">
                      {value}
                    </span>
                  </div>
                ))}
                <Separator />
                <p className="text-xs leading-5 text-muted-foreground">
                  FPS AI là tốc độ xử lý frame, không phải tốc độ phát video
                  trên trình duyệt.
                </p>
              </CardContent>
            </Card>
            <p className="flex items-start gap-2 px-1 text-xs leading-5 text-muted-foreground">
              <ArrowUpRight className="mt-0.5 size-4 shrink-0" />
              Next.js Server Actions → FastAPI → YOLOv8 + ByteTrack
            </p>
          </aside>
        </div>
        <footer className="pb-2 text-center text-xs text-muted-foreground">
          Traffic Vision · Đồ án ứng dụng YOLOv8 trong phân tích giao thông
        </footer>
      </main>
    </div>
  );
}
