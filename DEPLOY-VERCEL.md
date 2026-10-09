# Chạy khảo sát và database trong Vercel

Ứng dụng dùng Vercel Functions và **Neon Postgres tạo qua Vercel Storage**. Bạn tạo database, gắn với project và quản lý cấu hình ngay trong dashboard Vercel. Neon là dịch vụ database tích hợp của Vercel; Vercel Postgres cũ đã chuyển sang Neon. Bản này không cần tài khoản hoặc token Turso.

## 1. Đẩy source đã sửa

Đẩy nội dung `D:\[tạp nham]\app-scan-nh` lên repo, gồm `api`, `lib`, `public`, `scripts`, `package.json`, `package-lock.json` và `vercel.json`. Không đẩy `data`, `.env`, `node_modules`, `dist` hoặc `.vercel`.

Root Directory trên Vercel phải là thư mục chứa `package.json` và `vercel.json`. Nếu source ở gốc repo thì để trống.

## 2. Tạo database ngay trong Vercel

1. Mở project `survey` trong Vercel, bấm **Storage** ở menu trái. Bạn cũng có thể mở Marketplace trong Vercel.
2. Chọn **Neon / Neon Postgres**, tạo database. Chọn gói và region phù hợp trên màn hình tạo; có thể dùng gói Free nếu màn hình có lựa chọn này.
3. Dùng **Connect Project** để gắn database với project `survey`, chọn môi trường **Production**.
4. Giữ tên biến/tiền tố mặc định khi kết nối. Vercel sẽ thêm thông tin kết nối vào Environment Variables. Ứng dụng đọc `DATABASE_URL`, hoặc `POSTGRES_URL` nếu integration dùng tên này.

Không cần tự tạo bảng, viết SQL hoặc chép token database từ trang khác. Nếu database đã tạo rồi, chỉ cần kết nối database đó với project.

## 3. Đặt mật khẩu admin

Trong project → **Environment Variables**, thêm:

| Tên biến | Giá trị |
| --- | --- |
| `ADMIN_INITIAL_PASSWORD` | Mật khẩu bạn tự đặt, 12 đến 256 ký tự; chọn Production |
| `ADMIN_USERNAME` | Tùy chọn; mặc định là `admin` |

Ứng dụng tự tạo tài khoản và bộ khảo sát mặc định khi gọi API lần đầu. Mật khẩu khởi tạo chỉ được dùng nếu database chưa có tài khoản; deploy lại không đổi mật khẩu hay ghi đè dữ liệu. Sau đó đổi mật khẩu trong web như trước.

## 4. Deploy

Build settings đã có trong `vercel.json`:

- Framework Preset: **Other**.
- Node.js Version: **24.x**.
- Build Command: **npm run build**.
- Output Directory: **dist**.
- Install Command: **npm ci**.

Gỡ cấu hình cũ gọi `next build`. Sau khi gắn database và nhập mật khẩu, chọn **Redeploy**. Thay đổi Environment Variables chỉ áp dụng cho deployment mới.

Giữ **Automatically expose System Environment Variables** bật để ứng dụng nhận địa chỉ `*.vercel.app`. Nếu dùng tên miền riêng, thêm `APP_ORIGIN` bằng địa chỉ HTTPS của web, ví dụ `https://khaosat.example.com`, không kèm đường dẫn.

## 5. Sử dụng

- Link khảo sát: `https://ten-web.vercel.app/s/genai`.
- Trang admin: `https://ten-web.vercel.app/admin`.
- Đổi mật khẩu: `https://ten-web.vercel.app/admin?view=account`.

Bạn có thể xem database, project được kết nối và tình trạng sử dụng trong Vercel Storage. Quản trị, chỉnh câu hỏi, xem câu trả lời, xuất CSV và đổi mật khẩu đều thực hiện trong web khảo sát. Người trả lời chỉ cần link khảo sát.

Preview nên dùng database/nhánh riêng của integration. Chọn Production khi kết nối database chính; tránh cho bản thử dùng dữ liệu thật.

## Nếu vẫn lỗi

Mở `/api/health` trên website:

- `{"ok":true}`: database và tài khoản đã sẵn sàng.
- `DATABASE_CONFIG_MISSING`: database chưa gắn với project hoặc môi trường đang mở; kiểm tra Vercel Storage → Connect Project → Production.
- `ADMIN_PASSWORD_MISSING_OR_INVALID`: database đã kết nối nhưng chưa có mật khẩu admin hợp lệ; nhập `ADMIN_INITIAL_PASSWORD` rồi Redeploy.
- `DATABASE_URL_INVALID` hoặc `DATABASE_AUTH_FAILED`: kiểm tra đang gắn **Neon Postgres**, tên biến mặc định và kết nối integration với project; Redeploy sau khi sửa.
- 403: kiểm tra địa chỉ web và các biến hệ thống Vercel/`APP_ORIGIN`.

Không cần gửi mật khẩu hoặc chuỗi kết nối cho người khác. Thông báo lỗi không chứa giá trị bí mật.

## Chạy local và dữ liệu cũ

`npm ci` rồi `npm start` vẫn chạy local bằng SQLite nếu không có `DATABASE_URL`/`POSTGRES_URL`. `START.bat` cũng có thể cài thư viện và mở máy chủ local. Database và tài khoản local không bị thay đổi khi sửa code cho Vercel.

Database online là database riêng. Câu hỏi đã sửa và câu trả lời trong `data/survey.sqlite` không tự được đưa lên mạng. Để chuyển bộ câu hỏi, tải cấu hình JSON từ admin local, nhập vào trình chỉnh sửa admin online rồi lưu. Xuất CSV để giữ câu trả lời local trước đây.

`npm test` kiểm tra SQL Postgres bằng PGlite cùng kiểm tra SQLite local. `npm run build` tạo file công khai và kiểm tra cú pháp; không cần kết nối database khi build.

Tài liệu: [Vercel Storage](https://vercel.com/docs/marketplace-storage), [Neon tích hợp Vercel](https://vercel.com/marketplace/neon/neon), [Postgres trên Vercel](https://vercel.com/docs/postgres).
