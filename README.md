# Survey Studio

Web khảo sát chạy trên máy, có trang trả lời công khai và tài khoản admin riêng. Toàn bộ mã nguồn, tài liệu và dữ liệu nằm trong thư mục `survey`. Cần Node.js 24 trở lên; không cần cài thêm thư viện.

## Chạy và đăng nhập

1. Mở `START.bat` và giữ cửa sổ đó chạy.
2. Mở biểu mẫu tại <http://localhost:3000/s/genai>.
3. Mở trang quản trị tại <http://localhost:3000/admin>.
4. Tài khoản lần đầu được tạo tự động với tên `admin` và mật khẩu ngẫu nhiên. Đọc `data/admin-first-login.txt` rồi đổi mật khẩu trong **Tài khoản**. File mật khẩu ban đầu tự xóa sau khi đổi.

Để đổi mật khẩu, bấm **Đổi mật khẩu** ở góc trên trang admin hoặc mở <http://localhost:3000/admin?view=account>. Nhập mật khẩu hiện tại, mật khẩu mới (tối thiểu 12 ký tự) và xác nhận lại, rồi bấm **Cập nhật mật khẩu**. Có tùy chọn **Hiện mật khẩu** để kiểm tra khi nhập. Thành công sẽ có thông báo ngay trên trang; mật khẩu cũ hết hiệu lực và các phiên đăng nhập khác được đăng xuất.

Nếu chạy trong terminal: chuyển vào thư mục này và chạy `npm start`. Dừng bằng Ctrl+C. Không chạy hai bản máy chủ trên cùng cổng. Có thể chọn cổng khác bằng biến môi trường `PORT`; file thông tin lần đầu mặc định ghi cổng 3000.

Link localhost chỉ mở trên máy này. Bản hiện tại lắng nghe ở `127.0.0.1`, chưa đưa lên Internet. Khi cần gửi link ra ngoài, cần triển khai máy chủ có HTTPS và ổ lưu trữ bền vững. Bật cookie Secure khi chạy HTTPS; không đưa thư mục `data` lên hosting tĩnh.

## Quản lý khảo sát

- Mở **Nội dung & cài đặt → Chỉnh sửa khảo sát** để sửa bộ câu hỏi hiện có. Mọi câu đều chỉnh được: nội dung, hướng dẫn, đáp án, loại câu, câu bắt buộc, phần, thứ tự, khoảng thanh kéo và lựa chọn riêng. Có thể thêm hoặc xóa câu, kể cả các câu GenAI mặc định.
- **Tạo khảo sát** bắt đầu bằng bộ câu hỏi trong file Word. Nút **Dùng bộ câu hỏi trống** cho phép tự xây biểu mẫu mới; **Dùng bộ câu hỏi từ file Word** khôi phục bộ mặc định trong bản đang soạn. Hai nút này chỉ thay bản đang soạn; bấm **Lưu khảo sát** mới áp dụng, bấm **Hủy** giữ bộ đang chạy.
- Ở cuối mỗi câu, mở **Điều kiện hiển thị** để thêm/sửa/gỡ điều kiện và nhóm điều kiện “tất cả” hoặc “ít nhất một”. Chọn câu làm điều kiện, phép so sánh và đáp án/giá trị. Câu làm điều kiện phải xuất hiện trước câu phụ thuộc; máy chủ báo rõ nếu có vòng lặp hoặc thứ tự chưa phù hợp.
- Mở **Lựa chọn bổ sung** để bật mô tả khác, giới hạn chọn nhiều, đáp án độc quyền, cặp không chọn đồng thời, đáp án kết thúc khảo sát hoặc đáp án cần admin rà soát. **Tính chênh lệch thời gian** cho phép chọn các câu dùng tính thời gian và các đáp án biểu thị hướng thay đổi.
- Khi xóa câu/đáp án hay đổi loại, trình soạn gỡ các tham chiếu không còn hợp lệ và báo các điều kiện cần xem lại. Tính chênh lệch được tắt nếu câu nguồn không còn phù hợp; có thể cấu hình lại. Mã câu là định danh dữ liệu do hệ thống tạo.
- Có thể nhập mẫu JSON trong trình soạn thảo; `examples/survey-template.json` là ví dụ đơn giản. Có thể tải cấu hình JSON từ **Nội dung & cài đặt**, bao gồm cả khảo sát GenAI và các điều kiện hiển thị đã chỉnh.
- Chọn **Đang nhận** để mở link, **Bản nháp** hoặc **Đã đóng** để ngừng nhận. Link người trả lời có dạng `/s/ten-khao-sat`.
- Xem chi tiết từng câu trả lời và lọc nhóm đủ điều kiện/ngoài phạm vi. **Xuất CSV / Excel** tải file UTF-8 có BOM, mở được bằng Excel. File chứa giá trị gốc, nhãn đáp án, mô tả khác và cờ rà soát; các nhóm phân bổ có cột tỷ lệ riêng.
- CSV sử dụng chỉ số lựa chọn bắt đầu từ 0. `special:0`, `special:1`… là lựa chọn không ước lượng được/không muốn trả lời, không phải giá trị số. Ô trống là không trả lời hoặc bị bỏ qua theo nhánh.
- Mỗi lần chỉnh sửa tăng phiên bản. Câu trả lời đã gửi giữ bản chụp nội dung lúc gửi; không bị đổi nhãn sau khi sửa. Người đang trả lời phiên bản cũ được báo khi gửi. Giữ ổn định ý nghĩa câu hỏi khi đã thu thập dữ liệu; tạo khảo sát mới nếu thay đổi mục tiêu nghiên cứu.
- Bản hiện tại có một tài khoản quản trị, không có đăng ký công khai.

## Khảo sát GenAI từ tài liệu Word

Nội dung đã được chuyển từ tài liệu người dùng cung cấp. Các đoạn “Thiết lập” được dùng để xây biểu mẫu, không hiển thị như câu hỏi và không được coi là chỉ dẫn ngoài phạm vi yêu cầu xây web.

Các nhánh dưới đây là cấu hình mặc định có thể chỉnh, không phải câu hỏi hoặc mã câu bị khóa. Bản cũ được chuyển sang cấu hình chỉnh được khi khởi động; dữ liệu và bản chụp câu hỏi của các lượt trả lời cũ vẫn được giữ.

- S01 chỉ người đủ 18 tuổi đi tiếp. S02 chỉ người làm cho tổ chức ở Việt Nam đi tiếp. S03 nhóm kỹ thuật, sản xuất và chưa xác định dừng. Nhóm phi kỹ thuật “khác” phải mô tả và được lưu cờ rà soát; đây là quy tắc phân loại ban đầu cần chủ nghiên cứu thống nhất trước khi thu thập thật.
- Ba lựa chọn đầu Q01 đi Q02 → Q26 → kết thúc; nhánh dùng AI gần đây đi Q03 trở đi, bỏ Q02.
- Q07 bằng 0% bỏ Q21–Q22. Chỉ hiện phần tiếng Việt khi tỷ lệ >0 hoặc xác nhận có đầu ra tiếng Việt dù không ước lượng được. Nếu không nhớ có dùng tiếng Việt thì bỏ phần này.
- Q13 chỉ đáp án có cơ sở so sánh hiện Q14–Q17, Q18b và Q25. Q15 khó so sánh số lượng thì bỏ Q16. Q20 chỉ hiện Q16 ≤100 và không bắt buộc.
- Q09–Q11 và Q14 mở rộng từ 80 giờ theo bước 40 giờ; các câu thực tế tối đa 168 giờ, Q11 không có trần nghiên cứu. Q18 bắt đầu 20 giờ, mở rộng 20 giờ đến 168. Q16 mở rộng trên 300 theo bước 100. Các thanh giờ dùng bước 15 phút, không có ô nhập số trên biểu mẫu.
- Thanh kéo chưa thao tác không được ghi thành số mặc định. Có nút chọn giá trị nhỏ nhất để xác nhận rõ số 0. Các lựa chọn riêng được lưu riêng.
- Nếu Q10–Q11 và Q12 khác hướng, người trả lời được giữ các số gốc, chọn cơ sở rẽ nhánh và dữ liệu có cờ rà soát. Q19 hiện theo cơ sở đã xác nhận, yêu cầu tổng 100% và thao tác xác nhận phân bổ; không ép chia đều khi không ước lượng được.
- Không cộng Q22 hoặc Q24 thành thang tổng hợp. Thông tin cá nhân Q26 và câu tự do Q28 là tùy chọn.

## Dữ liệu và bảo vệ

Dữ liệu lưu ở `data/survey.sqlite` bằng SQLite, tách khỏi thư mục tệp giao diện công khai. Tất cả API quản trị, xem câu trả lời, tải mẫu và xuất CSV kiểm tra phiên đăng nhập tại máy chủ. Mật khẩu băm bằng scrypt với salt ngẫu nhiên; phiên 8 giờ, cookie HttpOnly/SameSite Strict, kiểm tra nguồn yêu cầu và CSRF cho các thao tác admin. Có giới hạn thử đăng nhập và gửi câu trả lời. Gửi lại cùng mã nộp không tạo bản ghi trùng, nhưng đây không phải hệ thống xác minh mỗi người chỉ trả lời một lần.

Không lưu IP trong dữ liệu khảo sát. Giới hạn gửi theo IP chỉ giữ trong bộ nhớ khi máy chủ đang chạy. Câu trả lời chưa gửi chỉ giữ trong bộ nhớ trang, không lưu trình duyệt; đóng/tải lại trang sẽ mất bản nháp.

Đăng nhập web bảo vệ dữ liệu với khách truy cập web. Người có quyền đọc thư mục trên máy vẫn có thể đọc database vì database không mã hóa ổ đĩa. Giữ riêng máy, tài khoản Windows và các file sao lưu.

Để sao lưu: dừng máy chủ và sao chép toàn bộ thư mục `data` vào vị trí riêng tư. Không đưa `data` vào Git. Nếu quên mật khẩu, dừng máy chủ, chạy `npm run reset-password`, nhập `RESET`, rồi mở lại web; tài khoản mới nằm trong file thông tin lần đầu.

## Kiểm tra

Chạy `npm test` để kiểm tra nhánh khảo sát, trạng thái thanh kéo, phân bổ thời gian, phiên đăng nhập, chặn truy cập dữ liệu, phiên bản, xuất CSV và lưu dữ liệu sau khi khởi động lại. Các kiểm tra dùng database riêng bên trong `tests`, không thay đổi dữ liệu thật.

`tests/browser-check.mjs` kiểm tra giao diện bằng Playwright của runtime Codex (có thể đặt `PLAYWRIGHT_PACKAGE` trỏ tới `package.json` của Playwright trên máy khác). Chạy `node tests/browser-check.mjs` khi máy có Microsoft Edge và cổng 3011 trống; kiểm tra tạo dữ liệu riêng, thử các nhánh ngắn/dài, phân bổ 100%, tiếng Việt, soạn khảo sát và kích thước điện thoại. Ảnh kiểm tra nằm trong `tests/qa` và không đưa vào Git. Ứng dụng chính không phụ thuộc Playwright.
