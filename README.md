# Traffic Vision

![Phiên bản ứng dụng 0.1.0](https://img.shields.io/badge/version-0.1.0-blue)

Traffic Vision là ứng dụng nhận diện và đếm phương tiện giao thông từ ảnh, video hoặc camera. Dự án dành cho sinh viên và người muốn thử nghiệm cách YOLO hỗ trợ thống kê lưu lượng xe trong một vùng quan sát.

## Tính năng nổi bật

- Nhận diện ô tô, xe máy, xe buýt, xe tải và xe đạp.
- Phân tích ảnh, video tải lên hoặc nguồn camera RTSP.
- Vẽ vùng đếm trực tiếp trên ảnh xem trước và xem thống kê theo từng loại xe.
- Bật theo dõi trên video và camera để đếm cộng dồn, mỗi ID xe chỉ tính một lần.

## Công nghệ sử dụng

- **Giao diện web:** TypeScript, React, Next.js, Tailwind CSS và shadcn/ui.
- **Xử lý AI:** Python, FastAPI, OpenCV, YOLOv8n và ByteTrack.
- **Dữ liệu:** Không cần cài cơ sở dữ liệu.

## Hướng dẫn bắt đầu

Các lệnh dưới đây dùng PowerShell trên Windows.

### 1. Điều kiện tiên quyết

- Git, Node.js **20.9 trở lên** (kèm npm) và Python **3.12**.
- Kết nối Internet để cài thư viện và tải mô hình ở lần chạy đầu nếu máy chưa có `yolov8n.pt`.

### 2. Cài đặt

```powershell
git clone https://github.com/kientruong392/Traffic-Analysis.git
cd Traffic-Analysis

cd vision-engine
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt

cd ../traffic-analysis-app
npm install
cd ..
```

### 3. Cấu hình

Từ thư mục gốc `Traffic-Analysis`, tạo file cấu hình cho giao diện web nếu bạn chưa có:

```powershell
if (-not (Test-Path traffic-analysis-app/.env.local)) {
    Copy-Item traffic-analysis-app/.env.example traffic-analysis-app/.env.local
}
```

Giá trị `AI_SERVICE_URL=http://127.0.0.1:8000` trong `.env.local` trỏ đến dịch vụ AI chạy trên máy của bạn. Nếu đổi cổng dịch vụ AI, cập nhật giá trị này rồi khởi động lại giao diện web.

### 4. Chạy dự án

Mở hai cửa sổ PowerShell tại thư mục gốc `Traffic-Analysis` và giữ cả hai cửa sổ trong lúc sử dụng.

**Cửa sổ 1 – Dịch vụ AI**

```powershell
cd vision-engine
.\venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

**Cửa sổ 2 – Giao diện web**

```powershell
cd traffic-analysis-app
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000), chọn một ảnh hoặc video tối đa **50 MB**, vẽ vùng đếm nếu cần rồi bấm **Bắt đầu phân tích**. Nếu giao diện báo chưa kết nối AI, kiểm tra cửa sổ 1 hoặc mở [trang kiểm tra dịch vụ AI](http://127.0.0.1:8000/health).
