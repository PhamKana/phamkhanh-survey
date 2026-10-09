# Đưa Survey Studio lên Vercel

Bản trong `app-scan-nh` hỗ trợ Vercel Functions + database libSQL online của Turso. Không cần Next.js. Giao diện, bộ câu hỏi mặc định, trình chỉnh sửa, dữ liệu riêng tư và đổi mật khẩu giữ nguyên. Máy chủ online không ghi SQLite hoặc mật khẩu ra file trên Vercel.

## 1. Tạo database

Tạo tài khoản tại https://turso.tech và tạo một **libSQL database**. Lấy Database URL dạng `libsql://...turso.io` và Auth Token có quyền đọc/ghi từ dashboard. Ứng dụng dùng `@libsql/client`, nên chọn database tương thích libSQL.

Token chỉ đặt trong cấu hình máy chủ. Không đưa token vào Git, file giao diện, tên biến `NEXT_PUBLIC_*` hoặc `VITE_*`.

## 2. Đẩy đúng thư mục source

Đẩy nội dung thư mục `D:\[tạp nham]\app-scan-nh` lên repository, bao gồm `api`, `lib`, `public`, `scripts`, `package.json`, `package-lock.json` và `vercel.json`. Không đẩy `data`, `.env`, `node_modules`, `dist` hoặc `.vercel`.

Trong Vercel, Root Directory phải trỏ tới thư mục chứa `package.json` và `vercel.json`. Nếu repo chứa source ngay ở gốc thì để trống; nếu source nằm trong một thư mục con thì chọn đúng thư mục đó.

## 3. Cấu hình Vercel

Ở **Settings → Build and Deployment**:

- Framework Preset: **Other**.
- Node.js Version: **24.x**.
- Build Command: **npm run build**.
- Output Directory: **dist**.
- Install Command: **npm ci**.

`vercel.json` đã khai báo những cấu hình trên và đường dẫn tới API. Gỡ các cấu hình cũ gọi `next build`; không thêm Next.js vào project này. Build không cần database và không đưa thông tin bí mật vào các file công khai.

Ở **Settings → Environment Variables**, thêm cho môi trường **Production**:

| Tên biến | Giá trị |
| --- | --- |
| `TURSO_DATABASE_URL` | URL database lấy từ Turso |
| `TURSO_AUTH_TOKEN` | Auth Token của database |
| `ADMIN_USERNAME` | `admin`, hoặc tên bạn chọn |
| `ADMIN_INITIAL_PASSWORD` | Mật khẩu bạn tự đặt, từ 12 đến 256 ký tự |
| `APP_ORIGIN` | Chỉ cần khi dùng tên miền riêng, ví dụ `https://khaosat.example.com` |

Với địa chỉ `*.vercel.app`, ứng dụng đọc các biến hệ thống Vercel để nhận diện địa chỉ. Giữ **Automatically expose System Environment Variables** bật. Nếu tắt, đặt `APP_ORIGIN` bằng chính địa chỉ HTTPS của web. Không thêm `/admin` hay `/s/genai` vào `APP_ORIGIN`.

Sau khi nhập xong, **Redeploy**. Thay đổi Environment Variables cũng cần deploy lại.

## 4. Mở web

- Link trả lời: `https://ten-web.vercel.app/s/genai`.
- Quản trị: `https://ten-web.vercel.app/admin`.
- Đổi mật khẩu: `https://ten-web.vercel.app/admin?view=account`.

Lần gọi API đầu tiên, ứng dụng tạo bảng, tài khoản admin và bộ khảo sát Word mặc định trong database. Đăng nhập bằng `ADMIN_USERNAME` và `ADMIN_INITIAL_PASSWORD` bạn đã đặt. Hai biến admin chỉ có tác dụng khi database chưa có tài khoản; deploy lại sẽ không ghi đè mật khẩu, câu hỏi đã sửa hoặc câu trả lời. Đổi mật khẩu trong web sẽ thu hồi các phiên khác.

## 5. Dữ liệu local và Preview

Database online là database riêng. Dữ liệu, câu hỏi đã chỉnh và mật khẩu trong file `data/survey.sqlite` trên máy **không tự được đưa lên mạng**. Nếu chỉ cần chuyển bộ câu hỏi đã sửa, tải cấu hình JSON từ admin local rồi nhập vào trình chỉnh sửa trên admin online và lưu. Câu trả lời cũ có thể xuất CSV từ bản local để giữ riêng.

Preview nên dùng database riêng cùng các biến môi trường riêng. Đừng cho các bản thử nghiệm dùng database Production nếu không muốn thao tác thử ảnh hưởng dữ liệu thật. Có thể chỉ cấu hình Production và thử bản triển khai Production; API Preview thiếu cấu hình sẽ trả 503.

Chạy local với SQLite như trước bằng `npm start` khi không có `.env` chứa cấu hình Turso. Để thử database online trên máy, sao chép `.env.example` thành `.env`, điền thông tin rồi chạy `npm start`. Không chia sẻ `.env`.

## Kiểm tra sau deploy

Mở `/api/health` phải thấy `{"ok":true}`. Chưa đăng nhập mà mở `/api/admin/surveys` phải nhận 401. Thử gửi một lượt khảo sát, xem trong admin, sửa một câu và đổi mật khẩu. Deploy lại rồi kiểm tra dữ liệu vẫn còn. Các file `/data/survey.sqlite`, `/.env` và `/server.mjs` phải trả 404.

Nếu `/api/health` trả 503, đọc `code` và `error`: thông báo sẽ chỉ rõ biến database còn thiếu, URL không hợp lệ, hoặc thiếu mật khẩu khởi tạo admin. Giá trị token và mật khẩu không được trả về. Sau khi sửa Environment Variables, chọn đúng Production/Preview rồi Redeploy; tải lại trang chưa đủ. Nếu trả 403, kiểm tra `APP_ORIGIN` hoặc các biến hệ thống Vercel. Nếu còn lỗi thiếu `app/pages`, kiểm tra Root Directory, commit đã deploy và xóa cấu hình Next.js cũ.

Tài liệu nền tảng: [Vercel Node Functions](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration), [Turso SDK](https://docs.turso.tech/sdk/ts/reference).
