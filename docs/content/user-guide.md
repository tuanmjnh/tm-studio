# Hướng dẫn sử dụng TMCut Studio

TMCut Studio là studio dựng video chạy trên nền TM Hub. Ứng dụng này lo phần **dựng, biên tập và xuất video**; còn TM Hub lo **đăng nhập, phân quyền, kết nối AI, thông báo và lưu trữ tài liệu**.

## 1. Trước khi bắt đầu

- **TM Hub phải truy cập được** — URL lấy từ `NUXT_PUBLIC_HUB_URL`. Bản đang cấu hình trỏ tới Hub
  production (`https://tm-hub-app.vercel.app`); khi phát triển cục bộ vẫn có thể trỏ về
  `http://localhost:4000`. Tài khoản đăng nhập studio là tài khoản của Hub, không có tài khoản riêng.
- Studio chạy ở `http://localhost:4003`.
- Nếu Hub không truy cập được, app vẫn mở nhưng các màn hình cần dữ liệu (AI, thông báo, tài liệu) sẽ báo
  lỗi hoặc dùng bản dự phòng đóng gói sẵn. Riêng gọi relay AI khi đó trả `401 error.unauthorized` vì token
  không qua được bước xác minh phía server — xem mục 10.

## 2. Đăng nhập và tài khoản

1. Mở `/login`, nhập email (hoặc tên đăng nhập) và mật khẩu của Hub. Form có xác thực phía client: không
   được để trống, mật khẩu tối thiểu 6 ký tự.
2. `Ghi nhớ đăng nhập` lưu **cả email và mật khẩu** vào `localStorage` của trình duyệt để lần sau tự điền.
   Bỏ tick thì entry bị xoá. Mật khẩu nằm dạng plaintext trong `localStorage` — chỉ bật trên máy cá nhân,
   không bật trên máy dùng chung (xem audit §63).
3. Quên mật khẩu: dùng `/forgot-password` → mở liên kết trong email → đặt lại tại `/reset-password`.
4. Chưa có tài khoản: `/register` (nếu Hub cho phép tự đăng ký).
5. Tài khoản bật 2FA sẽ được hỏi thêm mã TOTP ngay sau khi mật khẩu đúng.

Phiên làm việc:

- **Hồ sơ → Bảo mật** (`/system/settings/security`): đổi mật khẩu, xem các phiên đang đăng nhập và thu hồi phiên lạ.
- **Hồ sơ → Phiên** (`/system/settings/sessions`): danh sách phiên chi tiết.
- **Hồ sơ → Thông báo đẩy** (`/system/settings/push`): bật/tắt thông báo trình duyệt trên thiết bị này.

## 3. Điều hướng

Thanh bên trái gồm bốn nhóm:

| Nhóm | Trang | Dùng để |
| --- | --- | --- |
| Home | `/` | Bảng điều khiển: trạng thái Hub, phím tắt nhanh, thẻ tính năng |
| TMCut | `/tmcut`, `/tmcut/templates`, `/tmcut/factory`, `/tmcut/html-video`, `/tmcut/voice`, `/tmcut/autocut`, `/tmcut/process` | Toàn bộ quy trình làm video |
| Resources | Kết nối, Hộp thư, Thông báo | Kết nối dịch vụ, email nội bộ, thông báo hệ thống |
| System | Két khóa AI, Tài liệu, Tích hợp Hub, Hồ sơ, Cài đặt | Cấu hình và tra cứu |

Trên màn hình nhỏ, các thao tác chính được gom vào thanh hành động ở đáy màn hình. Nút đổi sáng/tối,
màu nhấn và ngôn ngữ nằm trong menu người dùng ở góc trái thanh bên (mục `Theme`), và cũng có bản đầy đủ ở
`/system/settings/appearance`. Màu nhấn và màu nền trung tính đã chọn được lưu lại; tải lại trang vẫn giữ.

## 4. Kết nối với TM Hub

Mở **Hệ thống → Tích hợp Hub** (`/system/hub-integration`):

- Kiểm tra **Hub URL**, **App ID** và trạng thái kết nối.
- App ID của studio có dạng `tm-studio_xxxxxx`; mọi dữ liệu riêng của studio (tài liệu, thông báo, kết nối) được gắn theo App ID này.
- Nếu trạng thái là lỗi: xác nhận Hub đang chạy, sau đó bấm `Làm mới`.

## 5. Két khóa AI (`/system/ai-keys`)

Đây là nơi khai báo nhà cung cấp AI dùng cho kịch bản, gợi ý dựng phim và trợ lý trong editor. Hub cung
cấp **danh mục** provider/model; key thì nằm trên máy bạn.

1. **Thêm kết nối**: chọn provider (Google AI, OpenAI, Anthropic, OpenRouter…), nhập API key và model mặc định.
2. **Kiểm tra**: bấm `Test` để gọi thử. Nếu key đúng, badge chuyển sang trạng thái hoạt động; key sai hoặc hết hạn sẽ báo lỗi ngay.
3. **Danh mục model**: nút chọn model tải danh sách model của provider; chỉ model có trong danh sách mới dùng được.
4. **Nhập / xuất**: hỗ trợ JSON, ENV và CSV để chuyển cấu hình giữa các máy. Khi xuất, bật tuỳ chọn che key nếu cần chia sẻ cấu hình.
5. **Nơi lưu key**: `config.env` trong thư mục dữ liệu của app, **mã hoá at-rest bằng `safeStorage` của hệ điều
   hành** khi máy có keychain. Nếu phiên chạy không với tới keychain (ví dụ trình duyệt web), banner đổi sang
   `The OS keychain is not reachable this session, so keys are stored as plaintext` — đọc banner trước khi
   lưu key. Key **không** gửi lên Hub; các trường trên Hub chỉ là danh mục và tham chiếu.

Lưu ý: model "thinking" có thể trả về nội dung rỗng nếu ngân sách token quá thấp. Nếu bài sinh ra trống, tăng số token đầu ra hoặc chọn model khác.

## 6. TMCut — quy trình làm video

### 6.1 Tạo dự án

1. Vào `/tmcut` → chọn `Vertical project (9:16)` hoặc `Horizontal project (16:9)`. Dự án mở thẳng trong
   editor; đổi tên sau đó bằng menu của thẻ dự án ở trang `/tmcut`.
2. Danh sách dự án nằm ở `/tmcut` với chế độ lưới/danh sách, tìm theo tên và sắp xếp theo lần sửa gần nhất
   hoặc theo tên.

### 6.2 Editor (`/tmcut/editor`)

Bố cục gồm bốn vùng:

- **Media Library** (trái): thư viện media, stickers, hiệu ứng, chuyển cảnh, bộ lọc, chợ tài nguyên.
- **Preview** (giữa trên): khung xem trước, tua, chỉnh âm lượng, đổi chất lượng xem trước giữa `Full Res`,
  `1/2 Res`, `1/3 Res`, `1/4 Res` (chỉ đổi độ phân giải hiển thị, không nén lại file).
- **Inspector** (phải): thuộc tính của clip đang chọn; các tab `Visual`, `Audio`, `Speed`, `Motion`,
  `Effects`, `Filters`.
- **Timeline** (dưới): track Video / Text / Audio, kéo thả clip, cắt, nhóm, đánh dấu.

Các thao tác thường dùng:

1. `Import Media` (hoặc kéo tệp từ Explorer/Finder vào panel) rồi bấm `Add to timeline`.
2. Đặt playhead rồi bấm `Split` (hoặc phím `S`) để cắt clip tại playhead. Ở đúng vị trí 0 sẽ báo
   "Place playhead over a clip to split" thay vì cắt rỗng.
3. Chọn clip → chỉnh ở Inspector; dùng keyframe để tạo chuyển động theo thời gian.
4. `Ctrl + S` để lưu, `Ctrl + E` để mở hộp thoại xuất video.
5. `Alt + A` mở AI Script & Storyboard; kết quả sinh ra được chèn thẳng vào timeline.

Phím tắt khác: `Space` phát/dừng, `J`/`K`/`L` tua, `←`/`→` bước 1 giây, `Alt + ←`/`Alt + →` bước từng
khung, `I`/`O` đặt In/Out, `Delete`/`Backspace` xoá clip, `Ctrl + Z` / `Ctrl + Shift + Z` hoàn tác/làm lại,
`Ctrl + D` nhân bản, `Ctrl + G` / `Ctrl + Shift + G` nhóm/bỏ nhóm, `Ctrl + L` / `Ctrl + Shift + L` liên kết,
`R` bật ripple, `N` bật bắt dính, `M` đặt marker, `Shift + D` bật/tắt fade, `?` / `F1` / `Ctrl + K` mở bảng
phím tắt.

### 6.3 Template Library (`/tmcut/templates`)

- Duyệt 30 template dựng sẵn, lọc theo tỉ lệ khung hình, ngành và danh mục; ô tìm kiếm lọc theo **tiêu đề
  và mô tả** (không tìm trong nội dung bài).
- `Customize & Create` mở form điền placeholder rồi tạo dự án mới; `Use Template` dùng thẳng.
- Việc **xuất bản (publish) một phiên bản** nằm ở **Template Studio** (nút `Template Studio` trên đầu
  trang), nơi draft được sửa, dry-run với dữ liệu mẫu, rồi publish thành version bất biến. Trang Library chỉ
  hiển thị và dùng lại.

### 6.4 Video Factory (`/tmcut/factory`)

Tạo video hàng loạt từ một template **đã publish** + danh sách đầu vào. Chọn template → dán CSV/JSON (hoặc
bấm `Sample rows` để lấy dòng mẫu) → `Validate & estimate` để xem plan và khoảng chi phí. Chạy thử bằng chế
độ `Dry run`; chế độ `Live provider` chỉ mở khoá khi bật ô "I understand this will spend money".

### 6.5 HTML Video Studio (`/tmcut/html-video`)

Dựng video từ HTML/CSS (dùng cho dạng đồ hoạ chuyển động, bảng số liệu, caption). Chỉnh mã trong khung soạn
thảo, xem trước trong iframe `sandbox="allow-scripts"`, rồi render. Có 13 composition mẫu để bắt đầu.

### 6.6 Voice Studio (`/tmcut/voice`)

Chuyển văn bản thành giọng nói. Có hai nguồn: **Local voice** (gọi VieNeu-TTS ở `http://127.0.0.1:8000`,
chạy trên máy này) và **Gemini TTS** (qua Hub). Nhãn `Check service` cho biết dịch vụ local có sống hay
không; khi không chạy, app báo `Offline — Could not reach VieNeu-TTS` thay vì im lặng.

### 6.7 AutoCut (`/tmcut/autocut`)

Bốn bước: tải clip nguồn → chọn profile cắt → `Analyze & Generate EDL` (AI) → xem lại EDL trước khi áp
dụng. Trang có thêm tuỳ chọn lọc từ đệm và trọng số ưu tiên nội dung do AI chấm.

### 6.8 Production process (`/tmcut/process`)

Đây **không phải** hàng đợi render. Trang này theo dõi quy trình sản xuất 12 bước có gate duyệt (từ episode
brief đến canon lock): mỗi bước ghi artifact thành tệp, và gate chỉ qua khi người duyệt ký. Nút
`Demo episode` tạo sẵn một run mẫu `S01E001` với 5/12 stage đã duyệt để thử.

Hàng đợi xuất video nằm trong editor: mở `Export Video` (`Ctrl + E`) để xem tiến độ encode và tải file.

## 7. Thông báo và hộp thư

- **Thông báo** (`/resources/notifications`): thông báo hệ thống từ Hub, lọc chưa đọc, đánh dấu đã đọc hoặc đọc tất cả. Tài khoản có quyền gửi sẽ thấy nút `Gửi thông báo`.
- **Hộp thư** (`/resources/inbox`): email nội bộ của nền tảng; xem, trả lời, lưu nháp.
- **Kết nối** (`/resources/connections`): trạng thái các dịch vụ ngoài (Cloudinary, email, AI) mà Hub đã cấu hình cho app.

## 8. Cài đặt hệ thống

- `/system/settings/appearance` (hoặc `/system/settings`) — theme sáng/tối/hệ thống, màu nhấn, màu nền
  trung tính và ngôn ngữ (Tiếng Việt / English). Màu nhấn và màu nền **được lưu** (`localStorage` key
  `tmstudio.ui.colors`), tải lại trang vẫn giữ; theme sáng/tối lưu riêng qua `nuxt-color-mode`.
- `/system/settings/profile` — thông tin cá nhân tài khoản.
- `/system/settings/security` — quản lý đổi mật khẩu, 2FA, Passkeys và thiết bị đăng nhập.
- `/system/settings/sessions` — quản lý các phiên làm việc hiện thời.
- `/system/settings/push` — quản lý đăng ký thông báo đẩy trình duyệt.
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

Dùng ô tìm kiếm để lọc theo **tiêu đề, mô tả và key** — không quét nội dung bài, nên một từ chỉ có trong
thân bài (ví dụ "export") sẽ không ra kết quả. Bộ chọn danh mục tách `guide` khỏi `docs` và `custom`.

## 10. Sự cố thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Đăng nhập xong bị đẩy về `/login` | Hub không truy cập được hoặc token hết hạn (~17 phút) | Kiểm tra `NUXT_PUBLIC_HUB_URL`, đăng nhập lại |
| Trang trắng / lỗi mạng | Hub không truy cập được | Xác nhận Hub trả `/api/v1/health`, tải lại trang |
| `401 error.unauthorized` ở `/api/v1/ai/relay/catalog` | Token Hub không qua được bước xác minh phía server | Đăng nhập lại; nếu vẫn lỗi, kiểm tra `AUTH_JWT_PUBLIC_KEYS` khớp Hub |
| AI báo "no content" | Model suy luận hết token trước khi trả lời | Tăng token đầu ra hoặc đổi model |
| Nút Test AI báo lỗi 401 | Key sai hoặc đã bị thu hồi | Tạo key mới ở provider, cập nhật lại |
| `502 error.tts.unreachable` ở Voice Studio | VieNeu-TTS không chạy trên máy này | Khởi động dịch vụ ở `127.0.0.1:8000`, hoặc dùng tab Gemini TTS |
| Tài liệu không có bài từ Hub | Chưa tạo bài hoặc bài ở app khác | Tạo bài đúng App ID, bật Published |
| Không tìm thấy bài theo từ khoá | Ô tìm kiếm chỉ đọc tiêu đề/mô tả/key | Tìm theo tiêu đề, hoặc lọc theo danh mục |
| Video xuất lỗi | Thiếu quyền ghi hoặc hết dung lượng | Kiểm tra thư mục đầu ra và dung lượng đĩa |
| Export báo từ chối vì effect | Có effect chưa nướng được vào file | Gỡ effect đó; preset LUT không có grain (Cool, Warm…) thì export được |
| Giao diện lạ sau khi cập nhật | Bản cache cũ | Tải lại cứng `Ctrl + Shift + R` |
| Phím tắt không ăn | Con trỏ đang ở ô nhập liệu | Bấm ra vùng timeline rồi thử lại |

Khi cần hỗ trợ, gửi kèm: thời điểm lỗi, trang đang mở, thông báo trong console và mã lỗi hiển thị (nếu có).
