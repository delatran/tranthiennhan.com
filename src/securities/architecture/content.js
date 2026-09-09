export const securitiesArchitectureContent = {
  vi: {
    skip: "Đi đến nội dung chính",
    language: "Ngôn ngữ",
    product: "Mở bàn nghiên cứu",
    portfolio: "Về Nhân",
    contents: "Khám phá kiến trúc",
    hero: {
      eyebrow: "Bên trong Nhân for Securities",
      title: ["Một câu trả lời.", "Cả đường đi đến nó."],
      description:
        "Một nhà đầu tư cần hiểu điều gì đang xảy ra với doanh nghiệp. Tôi xây Nhân for Securities để câu hỏi ấy đi được đến tài liệu gốc, phép tính rõ ràng và một hồ sơ có thể dùng tiếp.",
      explore: "Khám phá cách hoạt động",
      thought: "Lợi nhuận thay đổi ra sao?",
      questionLabel: "Bắt đầu từ điều cần hiểu",
      route: ["Tìm đúng nguồn", "Đối chiếu số liệu", "Hiểu điều đáng chú ý"],
      caption: "Nguồn gốc, phép tính và nhận định nằm trong cùng một hồ sơ.",
    },
    purpose: {
      index: "01",
      label: "Bắt đầu từ công việc",
      title: "Hiểu doanh nghiệp. Có căn cứ để kiểm tra.",
      description:
        "Người mới cần một điểm bắt đầu dễ hiểu. Người có kinh nghiệm cần đường dẫn để kiểm tra từng nhận định. Cả hai cùng dùng một bàn nghiên cứu.",
      items: [
        {
          icon: "compass",
          title: "Tìm cổ phiếu cần nghiên cứu",
          text: "Chọn một mã, xem bối cảnh thị trường và đặt câu hỏi bằng ngôn ngữ tự nhiên.",
        },
        {
          icon: "file",
          title: "Đọc số liệu cùng nguồn gốc",
          text: "Mở nguồn đằng sau con số, kiểm tra kỳ báo cáo và đọc tiếp phần thuyết minh liên quan.",
        },
        {
          icon: "folder",
          title: "Lưu kết quả để làm tiếp",
          text: "Lưu hồ sơ phân tích, hỏi tiếp trên cùng ngữ cảnh và xuất phần kết quả đủ căn cứ để làm việc tiếp.",
        },
      ],
    },
    journey: {
      index: "02",
      label: "Theo dấu một câu hỏi",
      title: "Chạm vào từng bước. Thấy điều diễn ra bên trong.",
      description: "Một tình huống nghiên cứu minh họa: từ chọn kỳ báo cáo đến lưu kết quả.",
      selector: "Các bước tạo hồ sơ nghiên cứu",
      resultLabel: "Bạn nhận được",
      detailLabel: "Xem cách hệ thống xử lý",
      exampleLabel: "Ví dụ minh họa",
      next: "Bước tiếp theo",
      restart: "Về đầu luồng",
      steps: [
        {
          id: "question",
          label: "Câu hỏi",
          icon: "chat",
          title: "Chốt điều cần hiểu.",
          text: "Bạn chọn doanh nghiệp, kỳ báo cáo và câu hỏi. Phạm vi phân tích được xác định trước khi hệ thống bắt đầu đọc.",
          result: "Một câu hỏi có đúng doanh nghiệp và kỳ so sánh.",
          detail:
            "React giữ trạng thái của bàn nghiên cứu trong một controller. Giao diện và công cụ WebMCP cùng đi qua các thao tác này, giúp đầu vào và trạng thái hiển thị nhất quán.",
          example: {
            heading: "Lợi nhuận thay đổi ra sao?",
            rows: [
              ["Doanh nghiệp", "Theo lựa chọn của bạn"],
              ["Kỳ đang xem", "6 tháng 2026"],
              ["Cơ sở so sánh", "Cùng phương pháp kế toán"],
            ],
          },
        },
        {
          id: "sources",
          label: "Tìm nguồn",
          icon: "search",
          title: "Đọc đúng chỗ trước khi trả lời.",
          text: "Hệ thống ưu tiên tài liệu công bố của doanh nghiệp. Tìm kiếm giúp chọn đường đi; đọc nguồn giúp lấy nội dung để kiểm tra.",
          result: "Liên kết nguồn và phần nội dung đọc được.",
          detail:
            "Web search và web fetch được giới hạn theo nguồn của doanh nghiệp. Với tài liệu đã xử lý, dịch vụ Node.js đọc PDF, trích xuất văn bản hoặc OCR các trang cần thiết. Một đoạn web đã đọc vẫn là nội dung tham khảo cho đến khi số liệu được đối chiếu.",
          example: {
            heading: "Báo cáo & thuyết minh",
            rows: [
              ["Ưu tiên", "Công bố của doanh nghiệp"],
              ["Nội dung cần đọc", "Kết quả kinh doanh · Thuyết minh"],
              ["Giữ kèm", "Liên kết · Tài liệu · Vị trí"],
            ],
          },
        },
        {
          id: "validation",
          label: "Đối chiếu",
          icon: "shield",
          title: "Đặt mỗi con số vào đúng ngữ cảnh.",
          text: "Một phép so sánh cần đúng doanh nghiệp, kỳ phù hợp và cơ sở kế toán rõ ràng. Các khác biệt được giữ cùng dữ liệu để bạn xem lại.",
          result: "Đầu vào có căn cứ và những điểm cần xử lý được chỉ rõ.",
          detail:
            "Dữ liệu gắn với mã băm của tài liệu và vị trí trang, bảng hoặc dòng. Kỳ báo cáo, đơn vị, phạm vi hợp nhất và cơ sở kế toán được kiểm tra. Ô thiếu hoặc chưa đối chiếu giữ nguyên trạng thái thay vì được điền số.",
          example: {
            heading: "Kiểm tra trước khi so sánh",
            rows: [
              ["Danh tính", "Đúng doanh nghiệp & tài liệu"],
              ["Khả năng so sánh", "Kỳ · Đơn vị · Phạm vi · Cơ sở"],
              ["Đường kiểm tra", "Tài liệu / Trang / Dòng"],
            ],
          },
        },
        {
          id: "calculation",
          label: "Tính toán",
          icon: "calculator",
          title: "Phép tính có thể làm lại.",
          text: "Chênh lệch và các tỷ lệ được tính từ đầu vào đã chọn. Bạn có thể xem công thức và lần ngược về con số ban đầu.",
          result: "Kết quả có công thức, đơn vị và các đầu vào đi kèm.",
          detail:
            "Lớp tính toán dùng số thập phân với BigInt để quản lý độ chính xác trước khi làm tròn. Cùng một đầu vào cho cùng một kết quả. Mẫu số bằng không, âm hoặc kỳ không tương thích có trạng thái riêng; mô hình ngôn ngữ sử dụng kết quả đã tính.",
          example: {
            heading: "Từ số liệu đến chỉ tiêu",
            rows: [
              ["Đầu vào", "Lợi nhuận sau thuế của hai kỳ so sánh được"],
              ["Công thức", "Lợi nhuận sau thuế kỳ này - Lợi nhuận sau thuế kỳ so sánh"],
              ["Kết quả", "Chênh lệch lợi nhuận sau thuế, cùng đơn vị"],
            ],
          },
        },
        {
          id: "explanation",
          label: "Giải thích",
          icon: "spark",
          title: "Giải thích bằng ngôn ngữ dễ hiểu.",
          text: "AI kết nối phần đã đọc với kết quả tính toán để giải thích điều đáng chú ý. Nhận định giữ liên kết tới bằng chứng để bạn mở xem khi cần.",
          result: "Một lời giải thích có thể đọc nhanh và kiểm tra sâu.",
          detail:
            "OpenRouter kết nối mô hình meta/muse-spark-1.3-contributor. Đầu ra có cấu trúc đi qua kiểm tra định danh nguồn, đoạn trích và tham chiếu chỉ tiêu. Số liệu trong lời giải thích được thay bằng giá trị của hệ thống; giả thuyết và dữ kiện được phân biệt.",
          example: {
            heading: "Một nhận định có cấu trúc",
            rows: [
              ["Nội dung", "Điều đáng chú ý với câu hỏi"],
              ["Căn cứ", "Đoạn gốc · Chỉ tiêu · Phép tính"],
              ["Tính chất", "Dữ kiện · Tính toán · Nhận định"],
            ],
          },
        },
        {
          id: "report",
          label: "Lưu hồ sơ",
          icon: "folder",
          title: "Lưu lại để tiếp tục nghiên cứu.",
          text: "Hồ sơ giữ lại câu hỏi, nguồn và kết quả. Bạn có thể quay lại, hỏi tiếp hoặc xuất báo cáo để tiếp tục nghiên cứu.",
          result: "Một hồ sơ có lịch sử và bản xuất gắn với dữ liệu đã xem.",
          detail:
            "D1/SQLite cục bộ lưu các bản ghi hồ sơ, công việc, chỉnh sửa và biên nhận. Trước khi xuất Markdown hoặc Excel, hệ thống dựng lại phần báo cáo đủ căn cứ từ đúng ảnh chụp dữ liệu; mục chưa giải quyết được tách khỏi kết luận.",
          example: {
            heading: "Hồ sơ nghiên cứu doanh nghiệp",
            rows: [
              ["Giữ lại", "Câu hỏi · Nguồn · Kết quả"],
              ["Làm tiếp", "Hỏi thêm · Kiểm tra · Cập nhật"],
              ["Mang theo", "Báo cáo Markdown · Excel"],
            ],
          },
        },
      ],
    },
    system: {
      index: "03",
      label: "Bản đồ hệ thống",
      title: "Mỗi phần làm tốt một việc.",
      description:
        "Giao diện, điều phối, đọc tài liệu và tính toán có trách nhiệm riêng. Kiến trúc bên dưới phản ánh bản nghiên cứu đang chạy cục bộ.",
      diagramLabel: "Các thành phần và luồng dữ liệu của Nhân for Securities",
      requestPath: "Luồng yêu cầu",
      supportPath: "Xử lý dữ liệu & lưu trữ",
      connection: "Lớp điều phối kết nối việc đọc tài liệu, tính toán và lưu hồ sơ",
      nodes: [
        {
          id: "browser",
          icon: "browser",
          technology: "React",
          title: "Nơi bạn làm việc",
          text: "Tìm mã, đặt câu hỏi, mở bằng chứng và theo dõi công việc.",
          detail: "Controller dùng chung cho giao diện và WebMCP.",
        },
        {
          id: "worker",
          icon: "server",
          technology: "Cloudflare Worker",
          title: "Điều phối & kiểm tra",
          text: "Nhận yêu cầu, kiểm tra đầu vào, quản lý công việc và trả kết quả.",
          detail: "Runtime Worker chạy cục bộ với Wrangler; khóa nhà cung cấp nằm phía máy chủ.",
        },
        {
          id: "model",
          icon: "spark",
          technology: "OpenRouter",
          title: "Tổng hợp & giải thích",
          text: "Dùng nội dung được cung cấp và kết quả tính sẵn để trả lời câu hỏi.",
          detail:
            "Mô hình cố định: meta/muse-spark-1.3-contributor. Mô hình có thể yêu cầu công cụ tìm và đọc nguồn trong phạm vi cho phép. Kết quả trả về tiếp tục được kiểm tra cấu trúc và tham chiếu nguồn trước khi dùng trong hồ sơ.",
        },
        {
          id: "ingestion",
          icon: "file",
          technology: "Node.js",
          title: "Xử lý tài liệu gốc",
          text: "Tải tài liệu, trích xuất nội dung và giữ vị trí của bằng chứng.",
          detail:
            "Dịch vụ Node.js đọc văn bản PDF hoặc nhận dạng chữ từ trang quét (OCR) trên máy chạy, ngoài runtime Worker. Tệp gốc được giữ riêng; kết quả trích xuất cần đối chiếu trước khi dùng làm số liệu.",
        },
        {
          id: "finance",
          icon: "calculator",
          technology: "JavaScript",
          title: "Tính toán có quy tắc",
          text: "Chuẩn hóa đơn vị, đối chiếu cùng kỳ và tính các chỉ tiêu.",
          detail:
            "Phép tính thập phân dùng BigInt để quản lý độ chính xác trước khi làm tròn. Công thức và đầu vào được giữ cùng kết quả, dùng lại khi dựng báo cáo.",
        },
        {
          id: "store",
          icon: "database",
          technology: "D1 / SQLite",
          title: "Lưu hồ sơ & lịch sử",
          text: "Giữ câu hỏi, nguồn, kết quả và các lần chỉnh sửa để có thể mở lại.",
          detail:
            "D1/SQLite cục bộ lưu hồ sơ, trạng thái công việc và biên nhận yêu cầu. Tài liệu gốc và tệp trích xuất được giữ trong kho tệp riêng.",
        },
      ],
      technical: "Chi tiết triển khai",
      coverageTitle: "Hai loại dữ liệu, hai việc cần làm.",
      coverageDetail: "Nguồn & phạm vi hiện có",
      coverage: [
        {
          id: "market",
          category: "Dữ liệu thị trường",
          title: "Tra cứu cổ phiếu",
          text: "Tìm mã, xem thông tin doanh nghiệp, giá gần nhất và diễn biến giá qua các phiên.",
          detail:
            "Dữ liệu từ nguồn công khai VNDIRECT, gồm danh mục cổ phiếu trên HOSE, HNX và UPCoM. Kết quả giữ nguồn và thời điểm truy xuất; thời điểm dữ liệu do nhà cung cấp trả về được hiển thị khi có.",
        },
        {
          id: "financial",
          category: "Báo cáo tài chính",
          title: "Đọc và đối chiếu kết quả kinh doanh",
          text: "Với báo cáo đã được xử lý, đối chiếu số liệu giữa các kỳ, mở bản gốc và đọc thuyết minh liên quan.",
          detail:
            "Phạm vi hồ sơ tài chính phụ thuộc vào các báo cáo đã được xử lý. Tài liệu mới chỉ trở thành đầu vào phân tích sau khi được trích xuất và đối chiếu.",
        },
      ],
    },
    decisions: {
      index: "04",
      label: "Những lựa chọn kỹ thuật",
      title: "Những điều hệ thống kiểm tra.",
      description:
        "Mỗi bước có điều kiện để đi tiếp: dữ liệu phù hợp, phép tính hợp lệ và kết quả có thể truy lại. Các kiểm soát dưới đây giữ những điều kiện đó.",
      items: [
        {
          title: "Bằng chứng đi cùng dữ liệu",
          text: "Bạn có thể mở lại tài liệu và vị trí đã lưu cho một con số hoặc đoạn trích.",
          detail:
            "Mã băm tài liệu, định danh nguồn, vị trí và trạng thái đối chiếu đi theo dữ liệu qua bước tính toán, giải thích và xuất báo cáo. Trích đoạn web chỉ hiện khi nội dung khớp với dữ liệu nguồn được đọc.",
        },
        {
          title: "Luật nghiệp vụ đứng trước lời giải thích",
          text: "Kỳ kế toán, đơn vị và phạm vi hợp nhất quyết định một phép so sánh có ý nghĩa hay không.",
          detail:
            "Các kiểm tra phân biệt thiếu dữ liệu với số không, chặn tỷ lệ tăng trưởng thông thường khi nền âm hoặc bằng không và giữ lại thay đổi phương pháp kế toán. Phép phân rã số học được phân biệt với nguyên nhân kinh doanh.",
        },
        {
          title: "Theo dõi tiến độ và xử lý lỗi",
          text: "Người dùng thấy tiến độ, có thể hủy và biết phần nào đã hoàn tất khi nguồn gặp lỗi.",
          detail:
            "Yêu cầu có định danh để kiểm soát gửi lặp. Công việc có thời hạn, trạng thái hủy và lưu dấu vết. Biên nhận ghi trạng thái, thời gian, token và chi phí khi nhà cung cấp trả về, làm cơ sở theo dõi và đánh giá.",
        },
        {
          title: "Kiểm thử theo từng trách nhiệm",
          text: "Kiểm tra riêng phần nguồn, phép tính, đầu ra AI và lưu trữ để tìm lỗi đúng chỗ.",
          detail:
            "Giao diện và WebMCP chia sẻ thao tác và kiểm tra trạng thái. Các phần tài chính, nguồn, model contract, lưu trữ và API có kiểm thử riêng. Kiểm thử phần mềm được tách khỏi đánh giá chất lượng nhận định thực tế.",
        },
      ],
    },
    closing: {
      eyebrow: "Từ kiến trúc đến trải nghiệm",
      title: "Thử với câu hỏi của bạn.",
      text: "Tôi xây phần kết nối giữa dữ liệu và việc người dùng cần làm: từ tìm tài liệu đến giải thích con số, kiểm tra bằng chứng và lưu kết quả.",
      signature: "Trần Thiện Nhân · Người xây Nhân for Securities",
    },
    footer: "Nhân for Securities · Kiến trúc & cách hoạt động",
    top: "Về đầu trang",
  },
  en: {
    skip: "Skip to main content",
    language: "Language",
    product: "Open research desk",
    portfolio: "About Nhân",
    contents: "Explore the architecture",
    hero: {
      eyebrow: "Inside Nhân for Securities",
      title: ["One answer.", "The path behind it."],
      description:
        "An investor needs to understand what is happening inside a business. I built Nhân for Securities to take that question through original documents, clear calculations and a research record you can keep working with.",
      explore: "Explore how it works",
      thought: "How has profit changed?",
      questionLabel: "Start with what you want to understand",
      route: ["Find the right source", "Check the numbers", "Understand what matters"],
      caption: "Original sources, calculations and claims stay in one research record.",
    },
    purpose: {
      index: "01",
      label: "Start with the work",
      title: "Understand the business. Inspect the evidence.",
      description:
        "A new investor needs a clear starting point. An experienced researcher needs a way to check each claim. Both can work at the same desk.",
      items: [
        {
          icon: "compass",
          title: "Find a stock to research",
          text: "Choose a stock, see its market context and ask a question in everyday language.",
        },
        {
          icon: "file",
          title: "Read figures with their sources",
          text: "Open the source behind a number, check its reporting period and follow the relevant notes.",
        },
        {
          icon: "folder",
          title: "Save findings for further work",
          text: "Save a research record, ask follow-up questions and export the supported findings for further work.",
        },
      ],
    },
    journey: {
      index: "02",
      label: "Follow a question",
      title: "Choose a step. See what happens inside.",
      description:
        "Follow an illustrative research question from choosing a reporting period to saving the findings.",
      selector: "Steps in creating a research record",
      resultLabel: "What you receive",
      detailLabel: "See how the system handles this",
      exampleLabel: "Illustrative example",
      next: "Next step",
      restart: "Back to the start",
      steps: [
        {
          id: "question",
          label: "Question",
          icon: "chat",
          title: "Define what you want to understand.",
          text: "Choose the business, reporting period and question. The scope is established before the system starts reading.",
          result: "A question tied to the right business and comparison period.",
          detail:
            "React keeps research state in a shared controller. The interface and WebMCP tools use the same actions to keep inputs and visible state consistent.",
          example: {
            heading: "How has profit changed?",
            rows: [
              ["Business", "Selected company"],
              ["Current period", "First half of 2026"],
              ["Comparison basis", "Same accounting method"],
            ],
          },
        },
        {
          id: "sources",
          label: "Sources",
          icon: "search",
          title: "Read the right material first.",
          text: "The system prioritizes the company's own disclosures. Search helps choose where to look; reading retrieves the material to check.",
          result: "Source links and the content successfully retrieved.",
          detail:
            "Web search and web fetch are scoped to company sources. For processed documents, a Node.js service reads PDFs, extracts text or applies OCR to the pages needed. A retrieved web passage remains reference material until financial figures are checked.",
          example: {
            heading: "Statements & accompanying notes",
            rows: [
              ["Priority", "The company's own disclosures"],
              ["Reading focus", "Income statement · Notes"],
              ["Kept alongside", "Link · Document · Location"],
            ],
          },
        },
        {
          id: "validation",
          label: "Validation",
          icon: "shield",
          title: "Put each number in context.",
          text: "A comparison needs the right business, compatible periods and a clear accounting basis. Differences stay with the data for you to inspect.",
          result: "Supported inputs with unresolved issues made visible.",
          detail:
            "Data is tied to the document's content hash and a page, table or row location. Reporting periods, units, consolidation scope and accounting basis are checked. Missing or unchecked cells retain their status.",
          example: {
            heading: "Check before comparing",
            rows: [
              ["Identity", "Right company & document"],
              ["Comparability", "Period · Unit · Scope · Basis"],
              ["Evidence path", "Document / Page / Row"],
            ],
          },
        },
        {
          id: "calculation",
          label: "Calculation",
          icon: "calculator",
          title: "Calculations you can reproduce.",
          text: "Changes and ratios are calculated from the selected inputs. You can inspect the formula and trace it back to the original numbers.",
          result: "A result with its formula, unit and input references.",
          detail:
            "The calculation layer uses decimal arithmetic backed by BigInt to manage precision before rounding. The same inputs produce the same result. Zero or negative denominators and incompatible periods have explicit states; the language model uses the calculated outputs.",
          example: {
            heading: "From figures to a metric",
            rows: [
              ["Inputs", "Profit after tax in two comparable periods"],
              ["Formula", "Current profit after tax - Comparison profit after tax"],
              ["Result", "Absolute change in profit after tax, in the same unit"],
            ],
          },
        },
        {
          id: "explanation",
          label: "Explanation",
          icon: "spark",
          title: "Explain the findings in plain language.",
          text: "AI connects the material it has read with the calculations to explain what matters. Claims retain evidence links you can open when needed.",
          result: "An explanation you can scan quickly and inspect closely.",
          detail:
            "OpenRouter connects the fixed meta/muse-spark-1.3-contributor model. Structured output is checked for source identifiers, excerpts and metric references. Numeric placeholders resolve to system values; hypotheses and facts are distinguished.",
          example: {
            heading: "A structured claim",
            rows: [
              ["Content", "What matters for the question"],
              ["Support", "Passage · Metric · Calculation"],
              ["Type", "Fact · Calculation · Interpretation"],
            ],
          },
        },
        {
          id: "report",
          label: "Saved report",
          icon: "folder",
          title: "Save the work so you can continue.",
          text: "The research record keeps your question, sources and findings. Return to it, ask a follow-up or export the report for further research.",
          result: "A saved record with history and an export tied to the reviewed data.",
          detail:
            "Local D1/SQLite stores research snapshots, jobs, corrections and receipts. Before exporting Markdown or Excel, the system rebuilds the supported report from that exact data snapshot; unresolved items are excluded from conclusions.",
          example: {
            heading: "Company research record",
            rows: [
              ["Keep", "Question · Sources · Findings"],
              ["Continue", "Ask · Check · Update"],
              ["Take with you", "Markdown report · Excel"],
            ],
          },
        },
      ],
    },
    system: {
      index: "03",
      label: "System map",
      title: "A clear job for each part.",
      description:
        "The interface, orchestration, document reading and calculations have separate responsibilities. This map reflects the current local research runtime.",
      diagramLabel: "Nhân for Securities components and data flow",
      requestPath: "Request path",
      supportPath: "Data processing & storage",
      connection: "Orchestration connects document reading, calculations and research storage",
      nodes: [
        {
          id: "browser",
          icon: "browser",
          technology: "React",
          title: "Your workspace",
          text: "Find stocks, ask questions, open evidence and follow progress.",
          detail: "A shared controller serves the interface and WebMCP tools.",
        },
        {
          id: "worker",
          icon: "server",
          technology: "Cloudflare Worker",
          title: "Orchestrate & validate",
          text: "Accept requests, check inputs, manage jobs and return results.",
          detail:
            "The Worker runtime runs locally with Wrangler; provider keys stay on the server.",
        },
        {
          id: "model",
          icon: "spark",
          technology: "OpenRouter",
          title: "Synthesize & explain",
          text: "Use supplied content and precomputed results to answer the question.",
          detail:
            "Fixed model: meta/muse-spark-1.3-contributor. The model can request source-search and reading tools within the permitted scope. Returned output is checked for structure and source references before being used in a research record.",
        },
        {
          id: "ingestion",
          icon: "file",
          technology: "Node.js",
          title: "Process original documents",
          text: "Fetch documents, extract their content and retain evidence locations.",
          detail:
            "A Node.js service reads PDF text or recognizes text on scanned pages with OCR on the host machine, outside the Worker runtime. Original files are retained separately; extracted figures need checking before use.",
        },
        {
          id: "finance",
          icon: "calculator",
          technology: "JavaScript",
          title: "Apply calculation rules",
          text: "Normalize units, check comparability and calculate financial metrics.",
          detail:
            "Decimal calculations use BigInt to manage precision before rounding. Formulas and input references stay with results and are reused when producing reports.",
        },
        {
          id: "store",
          icon: "database",
          technology: "D1 / SQLite",
          title: "Store records & history",
          text: "Keep questions, sources, findings and edits so the work can be reopened.",
          detail:
            "Local D1/SQLite stores research records, job states and request receipts. Original documents and extracted files are retained in a separate file store.",
        },
      ],
      technical: "Implementation details",
      coverageTitle: "Two kinds of data, two research tasks.",
      coverageDetail: "Current sources & coverage",
      coverage: [
        {
          id: "market",
          category: "Market data",
          title: "Look up a stock",
          text: "Find a ticker, view company information, the latest available price and price history.",
          detail:
            "Public VNDIRECT sources supply the stock directory for HOSE, HNX and UPCoM. Results retain their source and retrieval time; the provider's data timestamp is displayed when available.",
        },
        {
          id: "financial",
          category: "Financial statements",
          title: "Read and compare business results",
          text: "For processed reports, compare figures across periods, open the original document and read the relevant notes.",
          detail:
            "Financial dossier coverage depends on the reports already processed. A newly discovered document becomes an analytical input only after extraction and verification.",
        },
      ],
    },
    decisions: {
      index: "04",
      label: "Engineering choices",
      title: "What the system checks.",
      description:
        "Each step has conditions for continuing: suitable data, valid calculations and results that can be traced back. The controls below enforce those conditions.",
      items: [
        {
          title: "Evidence travels with the data",
          text: "You can reopen the document and saved location behind a figure or excerpt.",
          detail:
            "Document hashes, source identifiers, locations and verification status follow the data through calculation, explanation and export. A web excerpt is shown only when it matches retrieved source content.",
        },
        {
          title: "Business rules precede the explanation",
          text: "Accounting periods, units and consolidation scope determine whether a comparison is meaningful.",
          detail:
            "Checks distinguish missing values from zero, withhold ordinary growth rates for zero or negative baselines and preserve changes in accounting treatment. Arithmetic decomposition is distinguished from business causation.",
        },
        {
          title: "Track progress and handle failure",
          text: "Users see progress, can cancel and can tell what completed when a source fails.",
          detail:
            "Request identifiers control duplicate submissions. Jobs have deadlines, cancellation states and persisted records. Receipts capture status, timing, token usage and cost when the provider supplies them, supporting monitoring and evaluation.",
        },
        {
          title: "Test each responsibility separately",
          text: "Check sources, calculations, AI output and storage separately to locate failures.",
          detail:
            "The interface and WebMCP share actions and state checks. Finance, sources, model contracts, storage and APIs have focused tests. Software correctness is evaluated separately from the quality of real analytical claims.",
        },
      ],
    },
    closing: {
      eyebrow: "From architecture to experience",
      title: "Bring your own question.",
      text: "I built the connections that turn data into research work: finding documents, explaining numbers, checking evidence and keeping the results.",
      signature: "Trần Thiện Nhân · Builder of Nhân for Securities",
    },
    footer: "Nhân for Securities · Architecture & how it works",
    top: "Back to top",
  },
};
