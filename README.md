# Traffic Vision

Đồ án ứng dụng YOLOv8 vào phân loại và đếm phương tiện giao thông. Dashboard duy nhất dùng Next.js App Router, TypeScript, Tailwind CSS và shadcn/ui Base UI. AI Service dùng FastAPI, OpenCV, YOLOv8n và ByteTrack.

## Cấu trúc

```text
Traffic-Analysis/
├── README.md                            # Hướng dẫn chung cho frontend và backend
├── traffic-analysis-app/
│   ├── src/app/page.tsx                 # Dashboard và state React
│   ├── src/components/frame-canvas.tsx  # Vẽ ROI bằng chuột / cảm ứng
│   ├── src/components/ui/              # Component cài từ registry shadcn
│   ├── src/actions/traffic.ts           # Mọi request gửi tới FastAPI
│   └── src/lib/traffic.ts               # Kiểu dữ liệu dùng chung
└── vision-engine/
    ├── main.py                          # Endpoint FastAPI, kiểm tra request và trả JSON
    ├── config.py                        # Đường dẫn, class xe, ngưỡng YOLO và giới hạn
    ├── requirements.txt
    ├── yolov8n.pt                       # Trọng số (không đưa vào Git)
    └── core/
        ├── detector.py                  # Nạp YOLO, nhận diện, vẽ box và mã hóa Base64
        ├── tracker.py                   # ROI, ByteTrack, ID và bộ đếm từng loại xe
        └── stream_reader.py             # Mở video/RTSP, đọc frame và quản lý phiên
```

## Chạy ứng dụng trên Windows

Terminal 1 — AI Service (Python 3.12):

```powershell
cd D:\.Projects\Traffic-Analysis\vision-engine
# Chỉ tạo venv nếu chưa có: python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Đặt `yolov8n.pt` trong `vision-engine`. Ultralytics sẽ tải trọng số ở lần chạy đầu nếu chưa có. Mở `http://127.0.0.1:8000/docs` để xem các API. `lap` là dependency dùng cho bước ghép đối tượng của ByteTrack.

Terminal 2 — Next.js (Node.js 20.9 trở lên):

```powershell
cd D:\.Projects\Traffic-Analysis\traffic-analysis-app
npm install
npm run dev
```

Mở `http://localhost:3000`. Mặc định Server Actions gọi `http://127.0.0.1:8000`. Nếu đổi địa chỉ AI, thêm dòng này vào `.env.local` rồi khởi động lại Next.js:

```dotenv
AI_SERVICE_URL=http://127.0.0.1:8000
```

Biến này chỉ dùng trên server; không thêm tiền tố `NEXT_PUBLIC_`.

## Cách sử dụng

1. Chọn Upload Ảnh / Upload Video, hoặc nhập URL RTSP.
2. Kéo chuột trên ảnh xem trước để chọn ROI. Kéo theo hướng bất kỳ đều được; Xóa ROI sẽ chọn toàn khung.
3. Với camera, nhấn Kết nối camera để lấy ảnh xem trước, vẽ ROI rồi nhấn Bắt đầu / Tiếp tục.
4. Bật tracking để đếm xe duy nhất theo ID; tắt tracking để đếm xe hiện diện ở frame hiện tại.
5. Nhấn Tạm dừng để sửa ROI / tracking. Thay hai cấu hình này sẽ xóa bộ đếm, tạo tracker mới và tiếp tục tại vị trí video hiện tại. Muốn chạy lại từ đầu, nhấn Kết thúc rồi Phân tích lại.

Ảnh tĩnh luôn dùng chế độ hiện diện, vì một ảnh không có chuyển động để theo dõi.

## Luồng dữ liệu

```text
Client Component
  → Server Action (src/actions/traffic.ts)
  → FastAPI (vision-engine/main.py)
  → YOLOv8n → ByteTrack → đếm trong ROI
  → JSON: ảnh JPEG Base64 + thống kê + thông số model
  → Server Action → React state → canvas và sidebar
```

Client không có `fetch`, WebSocket hoặc URL ảnh trỏ trực tiếp tới FastAPI. Ảnh xem trước file dùng Blob URL cục bộ; kết quả AI là data URL Base64.

Video được upload **một lần** qua Server Action. Python mở video và giữ phiên trong RAM. Mỗi `processVideoChunkAction` yêu cầu xử lý **4 frame liên tiếp**, trả ảnh cuối của nhóm và bộ đếm mới. Không bỏ qua frame đầu vào ByteTrack. Trình duyệt chỉ gửi request tiếp theo khi request trước hoàn tất.

Đây là chế độ xử lý theo nhóm frame phù hợp đồ án, không phải phát video có âm thanh theo thời gian thực. FPS hiển thị là tốc độ xử lý AI; tốc độ cập nhật UI còn phụ thuộc CPU/GPU và thời gian gọi Server Action. RTSP đọc bằng OpenCV, nên có thể có độ trễ bộ đệm của camera; tạm dừng chỉ dừng xử lý, không dừng camera phát.

## Quy tắc đếm

- Chỉ nhận các COCO class: `1: xe đạp`, `2: ô tô`, `3: xe máy`, `5: xe buýt`, `7: xe tải`.
- ROI dùng tọa độ chuẩn hóa `[0, 1]`, sau đó đổi sang pixel của frame trên Python.
- Tracking bật: đếm một lần khi tâm xe nằm trong ROI hoặc đoạn nối hai tâm liên tiếp cắt ROI. Xe xuất hiện lần đầu ngay trong ROI cũng được đếm.
- Mỗi phiên giữ một `set` ID đã đếm, nên một ID quay lại ROI không bị cộng lần nữa.
- Tracking tắt / ảnh: thống kê số xe có tâm trong ROI ở frame đó, không cộng dồn.
- Nếu che khuất lâu khiến ByteTrack gán ID mới cho cùng xe thì vẫn có thể đếm lại. Bộ đếm không phân biệt chiều di chuyển.

Mỗi nguồn có ByteTrack và bộ đếm riêng. Trọng số YOLO dùng chung, có khóa để tránh chạy đồng thời trên cùng model.

Logic Python chia theo trách nhiệm: `main.py` nhận request và gọi hàm trong `core`; `stream_reader.py` đọc nguồn rồi đưa frame qua `detector.analyze_frame`; `detector.py` chạy YOLO và nhờ `tracker.py` gán ID, kiểm tra ROI, cập nhật bộ đếm trước khi vẽ kết quả. `config.py` chứa các tham số để dễ thử nghiệm. Các module `core` không import FastAPI; lỗi xử lý được `main.py` chuyển thành JSON, giữ nguyên endpoint và định dạng phản hồi cho Next.js.

## API của FastAPI

| Endpoint                   | Dữ liệu                              | Công dụng                                       |
| -------------------------- | ------------------------------------ | ----------------------------------------------- |
| `GET /health`              | Không                                | Thông số model thực tế                          |
| `POST /process-image`      | multipart: `file`, `roi` JSON        | Nhận diện ảnh, trả kết quả một lần              |
| `POST /sessions/video`     | multipart: `file`, `roi`, `tracking` | Upload video, trả `session_id` và ảnh xem trước |
| `POST /sessions/camera`    | JSON: `url`, `roi`, `tracking`       | Mở RTSP và trả ảnh xem trước                    |
| `POST /sessions/{id}/next` | JSON: `roi`, `tracking`              | Xử lý nhóm frame tiếp theo                      |
| `DELETE /sessions/{id}`    | Không                                | Giải phóng VideoCapture, xóa video tạm          |

Các hàm Python thường (`def`) chạy trong thread pool của FastAPI để OpenCV/YOLO không chặn event loop. Chỉ dùng **một Uvicorn worker**, vì phiên lưu trong RAM của tiến trình. Restart / reload Python sẽ mất các phiên đang mở; mở lại nguồn trên dashboard để tiếp tục.

File giới hạn 50 MB; Server Actions cho phép request 64 MB để chừa phần dư multipart. Ảnh đầu ra có cạnh dài tối đa 1280 px, YOLO dùng `imgsz=640`, confidence `0.25`. Tối đa 4 phiên; phiên không dùng trong 15 phút được dọn tự động. Video tạm cũng được xóa khi kết thúc hoặc đọc hết video. Dự án chạy cục bộ, không có auth theo phạm vi yêu cầu; không mở công khai các cổng dịch vụ.

## Kiểm tra

```powershell
# Frontend
cd D:\.Projects\Traffic-Analysis\traffic-analysis-app
npm run lint
npx tsc --noEmit
npm run build
```

Sau khi khởi động backend, mở `http://127.0.0.1:8000/health` để kiểm tra model đã được nạp. Trên dashboard, chọn ảnh hoặc video, vẽ ROI và bắt đầu phân tích để kiểm tra kết quả. Camera RTSP cần URL từ camera thực tế để kiểm tra kết nối đầu cuối.

Component trong `src/components/ui` được cài bằng `npx shadcn@latest add ...` theo cấu hình `base-luma`, không tự viết lại primitive UI. Build dùng `next/font/google` nên cần truy cập Google Fonts để tải font ở lần build đầu.
