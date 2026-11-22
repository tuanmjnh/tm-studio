# SOP: Quy trình sản xuất một tập phim Anime AI

## Chống trùng lặp nội dung, giữ continuity và tối ưu quy trình AI Agent

-   **Dự án:** Original AI Anime Series
-   **Thị trường:** Quốc tế, ưu tiên tiếng Anh
-   **Thể loại:** Anime hành động -- bí ẩn -- khoa học viễn tưởng/siêu
    nhiên
-   **Mục tiêu:** Sản xuất tập phim nguyên bản, nhất quán giữa các tập,
    có giá trị giải trí và đủ hồ sơ để kiểm tra chất lượng, quyền sử
    dụng và chính sách YouTube.
-   **Nguyên tắc:** AI đề xuất và thực hiện tác vụ; hệ thống kiểm tra
    bằng dữ liệu; con người duyệt các cổng quan trọng trước khi xuất
    bản.

> Đây là quy trình vận hành đề xuất. Các chỉ số kiểm tra là ngưỡng nội
> bộ để bắt đầu, không phải tiêu chuẩn hay bảo đảm của YouTube.

------------------------------------------------------------------------

# 1. Nguyên tắc bắt buộc

1.  **Không viết tập mới khi chưa đọc Series Bible và Episode Ledger.**
2.  Mỗi tập phải có một **câu hỏi kịch tính trung tâm**, một mục tiêu
    nhân vật, trở ngại, lựa chọn có hệ quả và kết quả riêng.
3.  Không dùng lại cùng một chuỗi sự kiện chỉ bằng cách đổi tên, địa
    điểm, trang phục hoặc lời thoại.
4.  Được phép lặp lại nhân vật, địa điểm, vật phẩm, chủ đề, motif và
    thông tin cần nhắc lại; nhưng **chức năng của chúng trong câu chuyện
    phải phát triển hoặc có lý do rõ ràng**.
5.  Manh mối đã được tiết lộ phải được ghi vào sổ continuity: ai biết,
    khán giả biết gì, điều gì đã được xác nhận và điều gì vẫn là giả
    thuyết.
6.  Không tự ý hồi sinh nhân vật, đổi quy luật thế giới, thay động cơ,
    sửa quá khứ hoặc đảo ngược kết quả tập trước.
7.  Không coi điểm tương đồng do embedding/LLM tạo ra là bằng chứng duy
    nhất. Phải kết hợp so sánh cấu trúc, sự kiện, mục tiêu, đạo cụ, lời
    thoại và đánh giá biên tập.
8.  Không xuất bản tự động nếu chưa qua kiểm tra cuối về nội dung, quyền
    sử dụng, nhãn Made for Kids, khai báo nội dung tổng hợp/chỉnh sửa
    khi áp dụng và metadata.
9.  Không sao chép kịch bản, nhân vật, cảnh, thoại, nhạc hoặc dấu hiệu
    nhận diện đặc trưng của tác phẩm có bản quyền.
10. Nếu dữ liệu lịch sử bị thiếu hoặc mâu thuẫn, **dừng và yêu cầu người
    phụ trách giải quyết**, không tự bịa canon.

# 2. Kiến trúc tài liệu cần có

Tạo và duy trì các tài liệu sau trong thư mục dự án. Có thể lưu dưới
dạng Markdown/JSON trong Git hoặc cơ sở dữ liệu.

``` text
project/
├── bible/
│   ├── series-bible.md
│   ├── world-rules.md
│   ├── character-bible.md
│   ├── visual-style-guide.md
│   └── audio-style-guide.md
├── continuity/
│   ├── episode-ledger.json
│   ├── timeline.md
│   ├── character-state.json
│   ├── clue-ledger.json
│   ├── unresolved-threads.md
│   └── canon-decisions.md
├── production/
│   └── episodes/
│       └── S01E001/
│           ├── episode-brief.md
│           ├── novelty-report.md
│           ├── outline.md
│           ├── script.md
│           ├── shot-list.json
│           ├── asset-manifest.json
│           ├── qa-report.md
│           └── publish-package.md
└── analytics/
    └── episode-performance.json
```

## 2.1 Series Bible --- nguồn sự thật chính

Series Bible phải mô tả:

-   Lời hứa cốt lõi của series và nhóm khán giả dự kiến.
-   Thể loại, giọng điệu, giới hạn nội dung và phong cách kể chuyện.
-   Luật thế giới: điều gì có thể/không thể xảy ra; chi phí và giới hạn
    của sức mạnh/công nghệ.
-   Hồ sơ nhân vật: mục tiêu, nỗi sợ, niềm tin, mối quan hệ, năng lực,
    giới hạn, giọng nói và trạng thái hiện tại.
-   Địa điểm, phe phái, vật phẩm quan trọng và chức năng của chúng.
-   Timeline chính thức, sự kiện đã xác nhận, bí mật chưa tiết lộ.
-   Quy chuẩn hình ảnh, màu sắc, khung hình, thiết kế nhân vật, thoại và
    âm thanh.
-   Các chủ đề có thể khai thác và những điều cần tránh.

Mỗi mục canon cần có `canon_id`, `version`, `status` (`proposed`,
`approved`, `deprecated`) và ngày cập nhật. Chỉ mục `approved` mới được
dùng làm sự thật chính thức.

## 2.2 Episode Ledger --- sổ lịch sử tập

Mỗi tập đã duyệt cần lưu tối thiểu:

``` json
{
  "episode_id": "S01E001",
  "title": "The Signal Beneath",
  "logline": "Một câu mô tả duy nhất về xung đột chính.",
  "central_question": "Tín hiệu đến từ đâu và nhân vật phải đánh đổi điều gì?",
  "protagonist_goal": "Mục tiêu cụ thể trong tập.",
  "opposition": "Người/lực lượng/quy luật cản trở.",
  "inciting_incident": "Sự kiện khởi phát.",
  "key_decision": "Lựa chọn không thể chỉ đảo ngược mà không có hệ quả.",
  "unique_set_pieces": ["set piece A", "set piece B"],
  "major_reveals": ["reveal A"],
  "character_changes": ["state before -> state after"],
  "clue_ids_introduced": ["CLUE-001"],
  "clue_ids_resolved": [],
  "world_rules_used": ["RULE-004"],
  "locations_used": ["LOC-002"],
  "assets_reused_with_reason": [],
  "ending_state": "Trạng thái canon sau tập.",
  "similarity_check": {
    "status": "pending",
    "compared_episode_ids": [],
    "reviewer": null
  },
  "status": "draft"
}
```

Không bắt buộc mọi trường phải có nội dung ở giai đoạn ý tưởng, nhưng
trước khi khóa kịch bản phải điền đủ các trường liên quan. Không ghi dữ
liệu dự kiến như thể đã là canon.

# 3. Quy trình sản xuất từ đầu đến cuối

## Giai đoạn 0 --- Tạo Episode ID và khóa phạm vi

**Đầu vào:** yêu cầu sản xuất tập mới, lịch phát hành và trạng thái
series.

**Thực hiện:** 1. Tạo ID bất biến, ví dụ `S01E007`. 2. Tạo thư mục làm
việc riêng cho tập. 3. Ghi rõ phiên bản Series Bible, timeline và
Episode Ledger được dùng. 4. Ghi mục tiêu sản xuất: thời lượng dự kiến,
ngôn ngữ, định dạng, deadline, ngân sách/giới hạn chi phí. 5. Kiểm tra
tập trước đã có trạng thái canon được duyệt chưa.

**Đầu ra:** `episode-brief.md` bản khung.

**Cổng kiểm tra:** Không bắt đầu viết nếu không biết tập trước kết thúc
ở trạng thái nào hoặc tài liệu canon có xung đột chưa giải quyết.

## Giai đoạn 1 --- Đọc lịch sử và lập bản đồ continuity

AI Continuity Agent đọc Series Bible và toàn bộ bản ghi liên quan, sau
đó tạo một bản tóm tắt có cấu trúc:

-   Trạng thái hiện tại của từng nhân vật chính.
-   Nhân vật nào đang ở đâu, biết điều gì, muốn gì và đang che giấu gì.
-   Timeline và khoảng thời gian đã trôi qua.
-   Vật phẩm quan trọng đang thuộc về ai.
-   Manh mối đã xuất hiện, đã giải quyết hoặc đang bị hiểu sai.
-   Các lời hứa với khán giả chưa trả lời.
-   Quy luật thế giới liên quan đến ý tưởng tập mới.
-   Những sự kiện/cảnh đã sử dụng nhiều lần.
-   Những mâu thuẫn canon đang chờ xử lý.

Bản tóm tắt phải dẫn về ID và nguồn dữ liệu cụ thể; không chỉ dựa vào
trí nhớ hội thoại của mô hình.

**Đầu ra:** `continuity-brief.json`.

**Cổng kiểm tra:** Người phụ trách duyệt các điểm mơ hồ hoặc xung đột
trước khi phát triển ý tưởng.

## Giai đoạn 2 --- Sinh nhiều ý tưởng khác biệt

Story Agent đề xuất 5--10 ý tưởng ngắn. Mỗi ý tưởng phải có:

-   Logline.
-   Mục tiêu nhân vật chính.
-   Câu hỏi kịch tính trung tâm.
-   Sự kiện khởi phát.
-   Trở ngại chính.
-   Lựa chọn có hệ quả.
-   Thay đổi quan trọng vào cuối tập.
-   Manh mối được thêm/giải quyết.
-   Lý do tập này cần tồn tại trong series.
-   Điểm mới so với các tập trước.

Không cho phép ý tưởng chỉ là "nhân vật điều tra một bí ẩn khác" nếu
cách điều tra, lựa chọn, phát hiện và hệ quả giống tập cũ.

### Thẻ ý tưởng chuẩn

``` yaml
idea_id: IDEA-007-A
working_title: ""
logline: ""
central_question: ""
protagonist_goal: ""
opposition: ""
inciting_incident: ""
irreversible_choice: ""
unique_set_piece: ""
reveal_or_reversal: ""
character_change: ""
continuity_payoff: ""
new_clue_ids: []
resolved_clue_ids: []
similar_past_episodes: []
differentiation_notes: ""
risks: []
```

## Giai đoạn 3 --- Kiểm tra trùng lặp trước khi chọn ý tưởng

So sánh từng ý tưởng với **tất cả tập đã có**, đặc biệt các tập cùng
nhân vật, địa điểm, loại bí ẩn hoặc cùng tuyến truyện.

### Các lớp so sánh bắt buộc

1.  **Ý tưởng bề mặt:** tên, logline, chủ đề, địa điểm.
2.  **Cấu trúc cốt truyện:** mở đầu, phát hiện, trở ngại, bước ngoặt,
    cao trào, kết thúc.
3.  **Chuỗi sự kiện:** A dẫn đến B, B dẫn đến C có giống tập cũ không.
4.  **Mục tiêu và động cơ:** nhân vật đang cố làm gì, vì sao và bằng
    cách nào.
5.  **Manh mối/cú lật:** thông tin được hé lộ có phải chỉ thay hình thức
    của cú lật cũ.
6.  **Set piece:** cảnh hành động, truy đuổi, đột nhập, đối đầu hoặc
    giải đố có bị tái sử dụng cùng chức năng.
7.  **Đối thoại:** câu chữ, nhịp thoại hoặc đoạn độc thoại có trùng đáng
    kể không.
8.  **Kết quả:** nhân vật có đạt cùng kết quả theo cùng cách mà không có
    phát triển mới không.

### Quy tắc quyết định

-   **PASS:** Có mục tiêu, diễn biến, lựa chọn, hệ quả và đóng góp cho
    series đủ khác biệt.
-   **REVISE:** Có tiềm năng nhưng một hoặc nhiều phần quan trọng quá
    giống tập cũ.
-   **REJECT:** Chủ yếu là bản sao cấu trúc của tập trước hoặc không có
    giá trị mới.
-   **HUMAN REVIEW:** Điểm tương đồng cao, dữ liệu không đầy đủ hoặc
    đánh giá tự động không chắc chắn.

Dùng embedding/similarity search để tìm tập cần so sánh, không dùng điểm
embedding làm phán quyết duy nhất.

### Bảng chấm điểm nội bộ

Chấm mỗi tiêu chí từ 0 đến 5; 0 = trùng/không có khác biệt đáng kể, 5 =
khác biệt rõ và có ý nghĩa.

  Tiêu chí                         Trọng số
  ------------------------------ ----------
  Mục tiêu và động cơ                   15%
  Chuỗi sự kiện/cấu trúc                20%
  Manh mối và bước ngoặt                15%
  Lựa chọn và hệ quả                    15%
  Set piece và cách giải quyết          15%
  Thay đổi nhân vật                     10%
  Giá trị mới cho series                10%

Công thức điểm khác biệt:

`Novelty Score = Σ (điểm tiêu chí / 5 × trọng số)`

Ngưỡng vận hành ban đầu: - `80–100`: có thể qua vòng kiểm tra, vẫn cần
review. - `65–79`: phải chỉnh sửa và chạy lại kiểm tra. - `<65`: không
duyệt; thiết kế lại ý tưởng. - Bất kể tổng điểm nào, nếu phát hiện sao
chép thoại/cảnh hoặc vi phạm canon nghiêm trọng thì phải chặn và review.

Điểm số chỉ giúp ưu tiên việc kiểm tra; không chứng minh một nội dung là
nguyên bản hoặc không vi phạm bản quyền.

**Đầu ra:** `novelty-report.md`, gồm các tập gần nhất, đoạn/beat giống
nhau, lý do giống, thay đổi đề xuất và quyết định của reviewer.

## Giai đoạn 4 --- Chọn ý tưởng và viết outline

Chọn một ý tưởng đáp ứng: - Phù hợp với lời hứa của series. - Có thể
hiểu được mà không cần giải thích quá nhiều lore. - Có một mục tiêu cụ
thể và một trở ngại thật. - Có thay đổi hoặc hệ quả có ý nghĩa. - Không
lặp lại chức năng của tập trước. - Có thể sản xuất trong ngân sách và
năng lực công cụ hiện tại.

Outline theo nhịp, không theo công thức cứng:

1.  **Hook:** Một hình ảnh, hành động hoặc câu hỏi cụ thể.
2.  **Setup:** Người xem hiểu nhân vật muốn gì.
3.  **Inciting incident:** Vấn đề buộc nhân vật hành động.
4.  **Escalation:** Ít nhất hai bước làm tình thế phức tạp hơn; tránh
    lặp lại cùng một kiểu thất bại.
5.  **Revelation:** Thông tin mới thay đổi cách hiểu trước đó.
6.  **Choice:** Nhân vật phải chọn giữa các phương án có hệ quả.
7.  **Climax:** Quyết định hoặc hành động giải quyết xung đột chính.
8.  **Resolution:** Cho thấy hệ quả, không chỉ cắt ngay khi bí ẩn xuất
    hiện.
9.  **Series thread:** Nếu cần, thêm một chi tiết nhỏ mở ra câu hỏi dài
    hạn.

Không bắt buộc tập nào cũng có đủ mọi nhịp hoặc phải có cú lật. Công
thức là công cụ kiểm tra, không phải khuôn làm cho mọi tập giống nhau.

**Cổng kiểm tra:** Người duyệt xác nhận outline và novelty report trước
khi viết lời thoại đầy đủ.

## Giai đoạn 5 --- Viết kịch bản và kiểm tra continuity

Kịch bản cần bao gồm: - Scene ID duy nhất, ví dụ `S01E007_SC03`. - Thời
gian/địa điểm và nhân vật hiện diện. - Mục đích của cảnh. - Hành động có
thể nhìn thấy/nghe thấy. - Lời thoại tiếng Anh tự nhiên. - Thông tin
khán giả biết sau cảnh. - Trạng thái nhân vật trước/sau cảnh. - Manh mối
được thêm, thay đổi hoặc giải quyết. - Chỉ dẫn âm thanh và hình ảnh cần
thiết.

### Kiểm tra sau bản nháp

-   Có nhân vật nào biết điều mà họ chưa thể biết không?
-   Có vật phẩm nào xuất hiện ở nơi không hợp lý không?
-   Timeline, thương tích, trang phục, năng lực và quan hệ có nhất quán
    không?
-   Quy luật thế giới có bị phá để tiện giải quyết cốt truyện không?
-   Lời thoại có chỉ lặp lại thông tin khán giả vừa thấy không?
-   Có cảnh nào chỉ nhắc lại một phát hiện đã rõ mà không thêm thông tin
    hoặc cảm xúc mới không?
-   Kết thúc có trả lời câu hỏi chính của tập không?
-   Những bí ẩn chưa giải có được ghi vào clue ledger không?
-   Có câu thoại/cảnh nào quá gần với nội dung đã sản xuất hoặc tác phẩm
    tham chiếu không?

Nếu thay đổi một sự kiện canon, tạo đề xuất sửa canon riêng; không âm
thầm sửa lịch sử.

**Đầu ra:** `script.md`, `continuity-diff.md` và bản sửa đổi được duyệt.

## Giai đoạn 6 --- Tách cảnh và tạo asset

Chia kịch bản thành shot list. Mỗi shot cần có: - `shot_id`,
`scene_id`. - Mục đích kể chuyện. - Cỡ cảnh, góc máy, chuyển động
camera. - Nhân vật, biểu cảm, hành động. - Bối cảnh, thời điểm, ánh
sáng. - Trạng thái trang phục, đạo cụ và vị trí. - Prompt hình
ảnh/video. - Asset tham chiếu đã duyệt. - Âm thanh, thoại, phụ đề. -
Thời lượng dự kiến. - Mức ưu tiên và tiêu chí chấp nhận.

### Quy tắc nhất quán hình ảnh

-   Dùng ID nhân vật và asset chuẩn; không mô tả lại ngoại hình theo
    cách tự do ở từng cảnh.
-   Giữ character sheet và reference image đã duyệt.
-   Lưu prompt, seed nếu công cụ hỗ trợ, model/version và asset đầu ra.
-   Không thay thiết kế nhân vật giữa tập nếu không có lý do trong cốt
    truyện.
-   Kiểm tra bàn tay, khuôn mặt, hướng nhìn, đạo cụ, chữ trong hình và
    tính liên tục chuyển động.
-   Chỉ tái sử dụng asset khi đúng mục đích; không lặp cảnh chỉ để kéo
    dài thời lượng.

**Đầu ra:** `shot-list.json`, `asset-manifest.json`.

## Giai đoạn 7 --- Tạo chuyển động, thoại và âm thanh

1.  Tạo keyframe hoặc clip thử cho các cảnh khó trước.
2.  Kiểm tra chuyển động, biểu cảm và sự liên tục giữa các shot.
3.  Tạo thoại tiếng Anh với cách phát âm tên riêng thống nhất.
4.  Kiểm tra nhịp thoại, độ rõ, âm lượng và sự đồng bộ môi.
5.  Dùng nhạc/hiệu ứng có quyền sử dụng phù hợp; lưu nguồn và điều kiện
    giấy phép.
6.  Nếu một cảnh lỗi, tạo lại đúng shot thay vì mặc định tạo lại toàn
    tập.
7.  Lưu phiên bản asset và lý do thay thế.

Không dùng giọng mô phỏng người thật hoặc asset của bên thứ ba nếu chưa
có quyền cần thiết.

## Giai đoạn 8 --- Dựng video

Dùng FFmpeg hoặc công cụ dựng phù hợp để: - Chuẩn hóa frame rate, độ
phân giải và âm thanh. - Ghép shot theo timeline đã duyệt. - Trộn thoại,
ambience, hiệu ứng và nhạc. - Tạo phụ đề tiếng Anh và kiểm tra đồng
bộ. - Kiểm tra chuyển cảnh, khoảng lặng, khung đen và lỗi encode. - Xuất
bản master ngang 16:9; tạo bản dọc riêng nếu cần Shorts.

Không chỉ cắt một video dài thành nhiều đoạn ngẫu nhiên. Mỗi Shorts phải
có ngữ cảnh, nhịp kể và mục tiêu riêng.

## Giai đoạn 9 --- QA nội dung, kỹ thuật và chính sách

### QA nội dung

-   Câu chuyện có dễ theo dõi không?
-   Hook có liên quan thật đến nội dung không?
-   Tập có trả lời câu hỏi chính không?
-   Có beat, cảnh hoặc lời thoại bị lặp không cần thiết không?
-   Nhân vật có hành động đúng động cơ và hiểu biết không?
-   Tập có giá trị riêng và đóng góp cho series không?

### QA kỹ thuật

-   Đúng độ phân giải, frame rate, aspect ratio và codec.
-   Thoại nghe rõ, không clipping; nhạc không lấn thoại.
-   Không lỗi khung hình, giật hình, âm thanh lệch hoặc phụ đề sai.
-   Thumbnail đọc được trên màn hình nhỏ và phản ánh đúng nội dung.
-   Tên file, ID tập và phiên bản đúng.

### QA chính sách

-   Đã rà soát quyền sử dụng âm nhạc, hình ảnh, font, giọng đọc và
    asset.
-   Đã đánh giá Made for Kids theo nội dung và đối tượng thực tế; không
    suy ra chỉ từ nhãn thể loại.
-   Đã xem xét yêu cầu khai báo nội dung altered/synthetic nếu có nội
    dung chân thực thuộc diện cần khai báo.
-   Không dùng tiêu đề/thumbnail gây hiểu nhầm hoặc gây sốc.
-   Không dùng nội dung hàng loạt, lặp lại thiếu giá trị sáng tạo.
-   Nếu có nội dung bạo lực, đánh giá mức độ và tính phù hợp với quảng
    cáo.

**Cổng kiểm tra:** QA tự động có thể chặn lỗi kỹ thuật rõ ràng; người
duyệt vẫn phải đánh giá nội dung, quyền sử dụng và nhãn chính sách.

## Giai đoạn 10 --- Đóng gói và xuất bản

Tạo `publish-package.md` gồm: - Tiêu đề tiếng Anh, không gây hiểu
nhầm. - Mô tả, credits và thông tin liên quan. - Thumbnail đã duyệt. -
Ngôn ngữ video và phụ đề. - Playlist và tập liên quan. - Đối tượng khán
giả: lựa chọn đúng theo đánh giá nội dung. - Khai báo altered/synthetic
content nếu áp dụng. - Trạng thái quyền sử dụng. - Ngày giờ dự kiến và
người duyệt.

Quy trình khuyến nghị: 1. Upload ở chế độ Private. 2. Kiểm tra bản phát
lại trên YouTube. 3. Kiểm tra metadata, thumbnail, phụ đề và các khai
báo. 4. Người phụ trách xác nhận lần cuối. 5. Chuyển sang
Scheduled/Public theo lịch đã duyệt.

Không cho phép agent tự đổi Made for Kids, tự bỏ qua cảnh báo bản quyền
hoặc công khai khi cổng duyệt chưa hoàn tất.

## Giai đoạn 11 --- Cập nhật canon và đo lường

Sau khi tập được duyệt/phát hành: - Chỉ cập nhật Episode Ledger từ bản
cuối đã duyệt, không lấy nội dung bản nháp làm canon. - Cập nhật
timeline, trạng thái nhân vật, clue ledger và unresolved threads. - Ghi
lại asset đã dùng và lý do tái sử dụng. - Lưu analytics snapshot ở các
mốc đã định, ví dụ 24 giờ, 72 giờ và 7 ngày. - So sánh với các tập cùng
định dạng, cùng thời lượng gần tương đương. - Đề xuất thử nghiệm tiếp
theo dựa trên dữ liệu, không tự động viết lại toàn bộ công thức từ một
video đơn lẻ.

# 4. Thiết kế AI Agent và trách nhiệm

  -----------------------------------------------------------------------
  Agent                   Nhiệm vụ                Không được tự làm
  ----------------------- ----------------------- -----------------------
  Orchestrator            Tạo job, kiểm soát      Bỏ qua cổng duyệt
                          trạng thái và           
                          dependency              

  Continuity Agent        Đọc canon, kiểm tra mâu Tự sửa canon
                          thuẫn, tạo continuity   
                          brief                   

  Story Agent             Sinh ý tưởng và outline Tự đánh dấu ý tưởng là
                                                  canon

  Novelty Agent           Tìm tập tương tự, lập   Tự kết luận pháp lý về
                          báo cáo khác biệt       bản quyền

  Script Agent            Viết thoại và chỉ dẫn   Tự thay đổi luật thế
                          cảnh                    giới

  Visual Agent            Tạo shot list và prompt Tự đổi thiết kế chuẩn
                                                  không có phê duyệt

  Production Agent        Gọi công cụ tạo         Tự xuất bản
                          ảnh/video/thoại và      
                          render                  

  QA Agent                Kiểm tra nội dung, kỹ   Tự bỏ qua lỗi nghiêm
                          thuật và chính sách     trọng

  Publishing Agent        Chuẩn bị upload và      Tự công khai khi chưa
                          metadata                duyệt

  Analytics Agent         Tổng hợp dữ liệu và đề  Tuyên bố nhân quả từ dữ
                          xuất thử nghiệm         liệu chưa đủ
  -----------------------------------------------------------------------

## Trạng thái job gợi ý

``` text
NEW
→ CONTEXT_LOADED
→ IDEAS_GENERATED
→ NOVELTY_REVIEW
→ OUTLINE_APPROVAL
→ SCRIPT_DRAFT
→ CONTINUITY_REVIEW
→ STORYBOARD
→ ASSET_GENERATION
→ EDITING
→ QA
→ PRIVATE_UPLOAD
→ FINAL_REVIEW
→ SCHEDULED / PUBLISHED
→ ANALYTICS_RECORDED
→ CANON_LOCKED
```

Mỗi trạng thái cần lưu thời gian, người/agent thực hiện, phiên bản đầu
vào, đầu ra, lỗi và số lần retry. Các trạng thái `REJECTED`,
`NEEDS_REVISION` và `BLOCKED` phải có lý do cụ thể.

# 5. Prompt mẫu cho các Agent

## 5.1 Continuity Agent

``` text
Bạn là Continuity Editor của một series anime nguyên bản.
Chỉ sử dụng Series Bible, Episode Ledger, timeline, character state
và clue ledger được cung cấp. Không tự bịa canon.

Hãy trả về:
1. Trạng thái canon hiện tại liên quan đến tập mới.
2. Những điều từng nhân vật biết/chưa biết.
3. Timeline, địa điểm và vật phẩm quan trọng.
4. Các manh mối đã mở, đã giải quyết và còn bỏ ngỏ.
5. Mâu thuẫn hoặc dữ liệu thiếu; trích ID nguồn.
6. Những motif, cấu trúc và set piece đã bị dùng nhiều lần.
7. Các giới hạn không được phá trong tập mới.

Nếu nguồn mâu thuẫn, đánh dấu BLOCKED và nêu câu hỏi cần người phụ trách quyết định.
Không tự sửa lịch sử hoặc biến giả thuyết thành sự thật.
```

## 5.2 Story Agent

``` text
Bạn là biên kịch cho một anime hành động-bí ẩn nguyên bản,
viết cho khán giả quốc tế và ưu tiên tiếng Anh tự nhiên.

Trước khi đề xuất ý tưởng, đọc continuity brief và novelty report.
Tạo các ý tưởng có mục tiêu nhân vật, trở ngại, lựa chọn có hệ quả,
diễn biến cụ thể và giá trị mới cho series.

Không được chỉ đổi tên, địa điểm, vật phẩm hoặc lời thoại của tập cũ.
Không lặp lại cùng chuỗi nguyên nhân-kết quả, cùng cú lật hoặc cùng
cách giải quyết nếu không có biến đổi đáng kể và có lý do trong cốt truyện.
Không sao chép tác phẩm có sẵn.

Mỗi ý tưởng phải nêu:
- Logline và câu hỏi kịch tính trung tâm
- Mục tiêu, đối lực và sự kiện khởi phát
- Các bước leo thang khác nhau
- Lựa chọn quan trọng và hệ quả
- Thay đổi nhân vật
- Manh mối thêm/giải quyết
- Tập cũ gần nhất và điểm khác biệt cụ thể
- Rủi ro continuity, sản xuất và chính sách

Nếu không tạo được ý tưởng khác biệt đủ rõ, hãy nói cần thêm dữ liệu thay vì
tạo ra một biến thể hời hợt.
```

## 5.3 Novelty Agent

``` text
Bạn là biên tập viên kiểm tra trùng lặp nội bộ.
So sánh ý tưởng/outline/kịch bản mới với các tập đã sản xuất được cung cấp.

So sánh theo: mục tiêu, động cơ, chuỗi sự kiện, cấu trúc, manh mối,
cú lật, set piece, lời thoại, kết quả và thay đổi nhân vật.

Không dựa riêng vào tiêu đề, từ khóa hoặc embedding score.
Báo cáo:
- Các tập tương tự nhất và ID
- Beat/cảnh/đoạn có nguy cơ lặp
- Mức độ giống và bằng chứng cụ thể
- Khác biệt có ý nghĩa hoặc điểm còn thiếu
- Đề xuất sửa để tạo mục tiêu, cơ chế, lựa chọn và hệ quả mới
- PASS / REVISE / REJECT / HUMAN REVIEW

Không đưa ra kết luận pháp lý rằng nội dung chắc chắn không vi phạm bản quyền.
```

## 5.4 Script QA Agent

``` text
Kiểm tra bản kịch bản dựa trên canon và novelty report đã duyệt.

Tìm:
- Lỗi timeline, địa điểm, trạng thái nhân vật và đạo cụ
- Nhân vật biết thông tin chưa được tiết lộ
- Quy luật thế giới bị phá hoặc năng lực không có giới hạn
- Cảnh/thoại lặp lại mà không thêm thông tin, cảm xúc hay hệ quả
- Hành động không khớp động cơ
- Bí ẩn bị giải quá dễ hoặc kết thúc không trả lời câu hỏi chính
- Đối thoại thiếu tự nhiên, exposition dư thừa
- Chi tiết quá giống tập cũ cần con người xem xét

Trả về lỗi theo mức CRITICAL / MAJOR / MINOR, scene ID, bằng chứng,
cách sửa đề xuất và trạng thái PASS / REVISE / BLOCKED.
Không tự sửa canon.
```

# 6. Cấu trúc dữ liệu và lưu vết

Tối thiểu nên có các thực thể: - `Series` - `Episode` - `CanonFact` -
`CharacterState` - `Clue` - `StoryBeat` - `Scene` - `Asset` -
`ProductionJob` - `Review` - `PublishJob` - `AnalyticsSnapshot`

Mỗi `Episode` lưu: - ID, trạng thái, phiên bản và series. - Phiên bản
canon đầu vào. - Ý tưởng được chọn và novelty report. - Outline, script,
shot list và manifest. - Kết quả review và người duyệt. - Các thay đổi
canon được chấp thuận. - Video master, thumbnail, metadata và trạng thái
upload. - Chi phí theo model/công cụ và kết quả phân tích.

Lưu lịch sử phiên bản thay vì ghi đè không dấu vết. Khi nội dung thay
đổi sau khi duyệt, các cổng liên quan phải chạy lại.

# 7. Definition of Done --- khi nào một tập được coi là hoàn thành?

Một tập chỉ được chuyển sang `PUBLISHED` khi tất cả mục bắt buộc sau
được xác nhận:

-   [ ] Series Bible và continuity brief đã được nạp đúng phiên bản.
-   [ ] Novelty report đã so sánh với các tập liên quan.
-   [ ] Ý tưởng, outline và kịch bản được duyệt.
-   [ ] Không còn lỗi continuity nghiêm trọng.
-   [ ] Câu chuyện có mục tiêu, trở ngại, lựa chọn và kết quả riêng.
-   [ ] Asset và quyền sử dụng được ghi nhận.
-   [ ] Video qua QA hình ảnh, âm thanh, phụ đề và encode.
-   [ ] Thumbnail/tiêu đề phản ánh đúng nội dung.
-   [ ] Made for Kids được đánh giá đúng theo nội dung thực tế.
-   [ ] Đã kiểm tra yêu cầu khai báo nội dung tổng hợp/chỉnh sửa khi áp
    dụng.
-   [ ] Video đã được kiểm tra sau khi upload Private.
-   [ ] Người có trách nhiệm đã duyệt xuất bản.
-   [ ] Episode Ledger, timeline, clue ledger và character state được
    cập nhật từ bản cuối.
-   [ ] Analytics job được lên lịch hoặc ghi nhận.

# 8. Nguyên tắc cuối cùng

**Không tối ưu hệ thống chỉ theo số video được tạo ra.** Tối ưu theo số
tập hoàn chỉnh có chất lượng, có sự khác biệt thực sự, giữ được
continuity, có quyền sử dụng rõ ràng và cung cấp dữ liệu đáng tin cậy để
cải tiến.

AI Agent nên làm tốt việc ghi nhớ bằng dữ liệu, tìm điểm tương đồng,
phát hiện lỗi, tạo bản nháp và tự động hóa thao tác lặp lại. Con người
chịu trách nhiệm với các quyết định sáng tạo quan trọng, duyệt canon và
cho phép xuất bản.
