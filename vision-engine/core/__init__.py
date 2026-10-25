"""Logic AI có thể sử dụng độc lập với các endpoint FastAPI."""


class ProcessingError(Exception):
    """Lỗi xử lý để main.py chuyển thành phản hồi JSON cho frontend."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code
