# Hướng dẫn sử dụng TMCut Studio

TMCut Studio là studio dựng video chạy trên nền TM Hub. Ứng dụng này lo phần **dựng, biên tập và xuất video**; còn TM Hub lo **đăng nhập, phân quyền, kết nối AI, thông báo và lưu trữ tài liệu**.

## 1. Trước khi bắt đầu

- **TM Hub phải chạy trước** (mặc định `http://localhost:4000`). Tài khoản đăng nhập studio là tài khoản của Hub, không có tài khoản riêng.
- Studio chạy ở `http://localhost:4003`.
- Nếu Hub không truy cập được, app vẫn mở nhưng các màn hình cần dữ liệu (AI, thông báo, tài liệu) sẽ báo lỗi hoặc dùng bản dự phòng đóng gói sẵn.

## 2. Đăng nhập và tài khoản

1. Mở `/login`, nhập tên đăng nhập và mật khẩu của Hub.
2. `Đăng nhập` để vào ứng dụng; `Ghi nhớ đăng nhập` chỉ lưu **tên tài khoản** trên máy, không lưu mật khẩu.
3. Quên mật khẩu: dùng `/forgot-password` → mở liên kết trong email → đặt lại tại `/reset-password`.
4. Chưa có tài khoản: `/register` (nếu Hub cho phép tự đăng ký).

Phiên làm việc:

- **Hồ sơ → Bảo mật** (`/system/profile/security`): đổi mật khẩu, xem các phiên đang đăng nhập và thu hồi phiên lạ.
- **Hồ sơ → Phiên** (`/system/profile/sessions`): danh sách phiên chi tiết.
- **Hồ sơ → Thông báo đẩy** (`/system/profile/push`): bật/tắt thông báo trình duyệt trên thiết bị này.

## 3. Điều hướng

Thanh bên trái gồm bốn nhóm:

| Nhóm | Trang | Dùng để |
| --- | --- | --- |
| Home | `/` | Bảng điều khiển: trạng thái Hub, phím tắt nhanh, thẻ tính năng |
| TMCut | `/tmcut`, `/tmcut/templates`, `/tmcut/factory`, `/tmcut/html-video`, `/tmcut/voice`, `/tmcut/autocut`, `/tmcut/process` | Toàn bộ quy trình làm video |
| Resources | Kết nối, Hộp thư, Thông báo | Kết nối dịch vụ, email nội bộ, thông báo hệ thống |
| System | Két khóa AI, Tài liệu, Tích hợp Hub, Hồ sơ, Cài đặt | Cấu hình và tra cứu |

Trên màn hình nhỏ, các thao tác chính được gom vào thanh hành động ở đáy màn hình. Nút đổi sáng/tối và ngôn ngữ nằm trong menu người dùng ở góc dưới trái.

## 4. Kết nối với TM Hub

Mở **Hệ thống → Tích hợp Hub** (`/system/hub-integration`):

- Kiểm tra **Hub URL**, **App ID** và trạng thái kết nối.
- App ID của studio có dạng `tm-studio_xxxxxx`; mọi dữ liệu riêng của studio (tài liệu, thông báo, kết nối) được gắn theo App ID này.
- Nếu trạng thái là lỗi: xác nhận Hub đang chạy, sau đó bấm `Làm mới`.

## 5. Két khóa AI (`/system/ai-keys`)

Đây là nơi khai báo nhà cung cấp AI dùng cho kịch bản, gợi ý dựng phim và trợ lý trong editor.

1. **Thêm kết nối**: chọn provider (Google AI, OpenAI, Anthropic, OpenRouter…), nhập API key và model mặc định.
2. **Kiểm tra**: bấm `Test` để gọi thử. Nếu key đúng, badge chuyển sang trạng thái hoạt động; key sai hoặc hết hạn sẽ báo lỗi ngay.
3. **Danh mục model**: nút chọn model tải danh sách model của provider; chỉ model có trong danh sách mới dùng được.
4. **Nhập / xuất**: hỗ trợ JSON, ENV và CSV để chuyển cấu hình giữa các máy. Khi xuất, bật tuỳ chọn che key nếu cần chia sẻ cấu hình.
5. **Khoá bí mật**: key được lưu phía Hub, studio chỉ giữ tham chiếu; không dán key vào mã nguồn hay tệp `.env` của studio.

Lưu ý: model "thinking" có thể trả về nội dung rỗng nếu ngân sách token quá thấp. Nếu bài sinh ra trống, tăng số token đầu ra hoặc chọn model khác.

## 6. TMCut — quy trình làm video

### 6.1 Tạo dự án

1. Vào `/tmcut` → `Dự án mới`, đặt tên và chọn tỉ lệ khung hình (16:9, 9:16, 1:1…).
2. Dự án mới mở thẳng trong editor; danh sách dự án nằm ở trang `/tmcut` với chế độ danh sách/lưới.

### 6.2 Editor (`/tmcut/editor`)

Bố cục gồm bốn vùng:

- **Media Library** (trái): thư viện media, stickers, hiệu ứng, chuyển cảnh, bộ lọc, chợ tài nguyên.
- **Preview** (giữa trên): khung xem trước, tua, chỉnh âm lượng, chuyển chế độ Full Res / Auto.
- **Inspector** (phải): thuộc tính của clip đang chọn (vị trí, kích thước, hiệu ứng, keyframe).
- **Timeline** (dưới): track Video / Text / Audio, kéo thả clip, cắt, nhóm, đánh dấu.

Các thao tác thường dùng:

1. Kéo media từ thư viện xuống timeline, hoặc bấm `Thêm video`.
2. Đặt playhead rồi bấm `Split` (hoặc phím `S`) để cắt clip tại playhead.
3. Chọn clip → chỉnh ở Inspector; dùng keyframe để tạo chuyển động theo thời gian.
4. `Ctrl + S` để lưu, `Ctrl + E` để mở hộp thoại xuất video.
5. `Alt + A` mở AI Script & Storyboard; kết quả sinh ra được chèn thẳng vào timeline.

Phím tắt khác: `Space` phát/dừng, `Delete` xoá clip, `Ctrl + Z` / `Ctrl + Shift + Z` hoàn tác/làm lại, `Ctrl + D` nhân bản, `Ctrl + G` nhóm, `Ctrl + L` liên kết clip, `?` hoặc `F1` mở bảng phím tắt.

### 6.3 Template Studio (`/tmcut/templates`)

- Duyệt template dựng sẵn theo danh mục, xem trước nội dung.
- **Tuỳ biến** để tạo bản nháp (draft) từ template; bản nháp sửa bao nhiêu lần cũng không ảnh hưởng template gốc.
- **Xuất bản** một phiên bản (version) khi đã ưu ý; lịch sử phiên bản được giữ nguyên, không ghi đè.

### 6.4 Video Factory (`/tmcut/factory`)

Tạo video hàng loạt từ một template + danh sách đầu vào (tiêu đề, mô tả, media). Chạy thử (dry run) trước để kiểm tra storyboard, sau đó mới chạy thật.

### 6.5 HTML Video Studio (`/tmcut/html-video`)

Dựng video từ HTML/CSS (dùng cho dạng đồ hoạ chuyển động, bảng số liệu, caption). Chỉnh mã trong khung soạn thảo, xem trước, rồi gửi render.

### 6.6 Voice Studio (`/tmcut/voice`)

Chuyển văn bản thành giọng nói (TTS), chọn giọng và tốc độ, nghe thử rồi thêm vào timeline dưới dạng track audio.

### 6.7 AutoCut (`/tmcut/autocut`)

Tự động cắt khoảng lặng và chia cảnh từ một video dài; xem lại từng đoạn được đề xuất trước khi áp dụng vào dự án.

### 6.8 Hàng đợi xử lý (`/tmcut/process`)

Theo dõi các tác vụ nền (render, phân tích media, tách âm thanh). Mỗi mục hiển thị tiến độ, thời điểm bắt đầu và lỗi nếu có.

## 7. Thông báo và hộp thư

- **Thông báo** (`/resources/notifications`): thông báo hệ thống từ Hub, lọc chưa đọc, đánh dấu đã đọc hoặc đọc tất cả. Tài khoản có quyền gửi sẽ thấy nút `Gửi thông báo`.
- **Hộp thư** (`/resources/inbox`): email nội bộ của nền tảng; xem, trả lời, lưu nháp.
- **Kết nối** (`/resources/connections`): trạng thái các dịch vụ ngoài (Cloudinary, email, AI) mà Hub đã cấu hình cho app.

## 8. Cài đặt hệ thống

- `/system/settings` — tuỳ chọn chung của app: giao diện, ngôn ngữ, hiển thị.
- `/system/settings/system` — thông tin môi trường, phiên bản, chẩn đoán.
- `/system/settings/production` — cấu hình dành cho môi trường chạy thật; chỉ đổi khi biết rõ ảnh hưởng.

## 9. Trung tâm tài liệu (`/system/docs`)

Trang này gom mọi bài tài liệu của app:

- **Bài viết local**: hướng dẫn sử dụng (tệp này) và bộ tham chiếu API/kiến trúc đóng gói sẵn.
- **Bài viết từ Hub**: tài liệu do quản trị viên tạo ở **TM Hub → Administration → Content & Docs**, gắn App ID của studio, danh mục `docs` hoặc `guide`, định dạng `markdown`, `html`, `json` hoặc `text`.

Cách thêm bài mới:

1. Mở Hub → `Administration` → `Content & Docs` → `Create`.
2. Chọn **Application** = app của studio (`tm-studio_…`), đặt `Key` (duy nhất), `Title`, `Category`, `Format`.
3. Dán nội dung, bật `Published`, lưu.
4. Trong studio, mở lại `/system/docs` và bấm `Làm mới` — bài mới xuất hiện trong danh sách bên trái.

Dùng ô tìm kiếm để lọc theo tiêu đề/mô tả, và bộ chọn danh mục để tách `guide` khỏi `docs`.

## 10. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Đăng nhập xong bị đẩy về `/login` | Hub không chạy hoặc token hết hạn | Kiểm tra Hub ở `:4000`, đăng nhập lại |
| Trang trắng / lỗi mạng | Hub không truy cập được | Bật Hub trước, tải lại trang |
| AI báo "no content" | Model suy luận hết token trước khi trả lời | Tăng token đầu ra hoặc đổi model |
| Nút Test AI báo lỗi 401 | Key sai hoặc đã bị thu hồi | Tạo key mới ở provider, cập nhật lại |
| Tài liệu không có bài từ Hub | Chưa tạo bài hoặc bài ở app khác | Tạo bài đúng App ID, bật Published |
| Video xuất lỗi | Thiếu quyền ghi hoặc hết dung lượng | Kiểm tra thư mục đầu ra và dung lượng đĩa |
| Giao diện lạ sau khi cập nhật | Bản cache cũ | Tải lại cứng `Ctrl + Shift + R` |
| Phím tắt không ăn | Con trỏ đang ở ô nhập liệu | Bấm ra vùng timeline rồi thử lại |

Khi cần hỗ trợ, gửi kèm: thời điểm lỗi, trang đang mở, thông báo trong console và mã lỗi hiển thị (nếu có).
