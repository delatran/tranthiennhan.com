export const locales = ["en", "vi"];

export const content = {
  en: {
    meta: {
      title: "Trần Thiện Nhân · AI Engineer",
      description:
        "Trần Thiện Nhân is an AI Engineer working on customer-service call scoring, multimodal Document AI, and LoRA security research.",
    },
    skip: "Skip to content",
    language: "Language",
    brand: "Trần Thiện Nhân",
    nav: {
      primaryLabel: "Primary navigation",
      mobileLabel: "Mobile navigation",
      about: "How I work",
      experience: "Experience",
      work: "Selected projects",
      product: "X Nhân",
      contact: "Contact",
      open: "Open navigation",
      close: "Close navigation",
    },
    hero: {
      eyebrow: "AI Engineer",
      role: "AI Engineer · Applied AI systems",
      statement:
        "I work with business teams to turn requirements into AI workflows, APIs, tests, and systems people can use day to day.",
      primary: "View selected projects",
      secondary: "Contact me",
      location: "Ho Chi Minh City, Vietnam",
      proofLabel: "Project highlights",
      proofs: [
        {
          value: "In production",
          label: "Customer-service call scoring",
          note:
            "Used by Customer Service to evaluate agents; estimated to save VND 180 million a year in operating costs.",
        },
        {
          value: "3 pipelines",
          label: "Multimodal Document AI",
          note:
            "Synchronous and asynchronous processing; currently in development.",
        },
        {
          value: "0.96875 AUROC",
          label: "LoRA backdoor screening study",
          note: "Weight-only method, measured on eight valid test lineages.",
        },
      ],
    },
    about: {
      eyebrow: "How I work",
      title: "How I work on an AI project",
      body:
        "In my current role, I work with business teams and the systems around the model, not only the model itself. I scope the problem, build the workflow and API, test failure cases, and support integration.",
      principles: [
        {
          index: "01",
          title: "Clarify the requirement",
          text:
            "Work with the business team to define the input, the expected output, and where that output will be used.",
        },
        {
          index: "02",
          title: "Build the pipeline and API",
          text:
            "Design prompts and output schemas, implement the data flow, and connect the model’s output to the surrounding systems.",
        },
        {
          index: "03",
          title: "Test what can go wrong",
          text:
            "Validate outputs, retry recoverable failures, prevent duplicate batch work, and add the logs and health checks needed to support the service.",
        },
      ],
    },
    experience: {
      eyebrow: "Background",
      title: "Experience and education",
      intro:
        "I currently work in the Technology Division at Kien Long Bank. Before that, I completed an IT internship at Mercedes-Benz Vietnam. I earned an Information Security degree at PTIT and am now pursuing a master’s degree in Information Systems.",
      roles: [
        {
          role: "R&D Solutions Specialist",
          organizationKey: "kienlongbank",
          organization: "KienlongBank",
          organizationDetail:
            "Technology Division · Kien Long Commercial Joint Stock Bank",
          dates: "May 2025 to present",
          summary:
            "I build AI systems for banking teams, from clarifying requirements to implementation, integration, and testing.",
          highlights: [
            "Built and launched the customer-service call-quality scoring system now used by Customer Service to evaluate agents.",
            "Designed and implemented three Multimodal Document AI pipelines for business PDFs; the project is currently in development.",
          ],
          tags: [
            "GenAI",
            "Document AI",
            "Speech AI",
            "FastAPI",
            "Data pipelines",
          ],
        },
        {
          role: "Information Technology Intern",
          organizationKey: "mercedesBenz",
          organization: "Mercedes-Benz Vietnam",
          organizationDetail: "Information Technology",
          dates: "Aug 2024 to Feb 2025",
          summary:
            "Supported incident handling, system maintenance, and data digitization in a multinational enterprise environment.",
          highlights: [
            "Worked within established processes and coordinated technical work in English.",
          ],
          tags: [
            "IT operations",
            "Incident support",
            "Data digitization",
            "English collaboration",
          ],
        },
      ],
      skillsLabel: "Skills and tools",
      educationLabel: "Education",
      educationInstitution:
        "Posts and Telecommunications Institute of Technology",
      educationCampus: "Ho Chi Minh City campus",
      education: [
        {
          degree: "Master’s student · Information Systems",
          dates: "Jun 2025 to present",
        },
        {
          degree: "B.Eng. · Information Security",
          dates: "Oct 2020 to Jan 2025",
        },
      ],
      credentialsLabel: "Credentials and recognition",
      credentials: [
        {
          title: "Google Cybersecurity Professional Certificate",
          detail: "Google / Coursera · Mar 2024",
        },
        {
          title: "Second Prize · 2023 Student Research Award",
          detail: "Phishing detection using layout features",
        },
        {
          title: "Academic Excellence Scholarship",
          detail: "Dec 2024 · Semester GPA 3.79 / 4.00",
        },
      ],
      languagesLabel: "Languages",
      languages: [
        { name: "Vietnamese", level: "Native" },
        {
          name: "English",
          level: "Upper-intermediate",
        },
      ],
    },
    work: {
      eyebrow: "Selected projects",
      title: "Selected AI projects",
      intro:
        "The call-scoring system is in production; Document AI is still being built; the LoRA audit is complete. Each case explains the problem, what I did, and where it stands today.",
      labels: {
        index: "Project index",
        period: "Project period",
        goal: "Project goal",
        contribution: "My contribution",
        outcome: "Current result",
        scope: "What to keep in mind",
        metrics: "Key facts",
        stack: "Technology",
      },
      items: [
        {
          slug: "call-scoring",
          index: "01",
          status: "In production",
          tone: "production",
          dates: "Aug 2025 to May 2026",
          title: "Customer-service call quality scoring",
          summary:
            "I built a speech-and-LLM workflow that scores customer-service calls against defined criteria and records the transcript passage or technical check behind each deduction.",
          goal:
            "Score more calls consistently while keeping every deduction traceable to the transcript or a technical signal.",
          contribution:
            "I built the LangGraph workflow for transcription, speaker handling, intent classification, and criterion-level LLM scoring. FastAPI serves the results, PostgreSQL stores them, and the workflow validates structured outputs, retries recoverable failures, and avoids duplicate batch processing.",
          outcome:
            "The system is in production, and Customer Service uses its output in the agent-evaluation process. The estimated reduction in annual operating cost is VND 180 million.",
          scope:
            "I have not published accuracy, latency, or UAT figures for this system.",
          metrics: [
            {
              value: "VND 180M / yr",
              label: "Estimated operating-cost reduction",
            },
            {
              value: "Transcript or signal",
              label: "Source for each deduction",
            },
          ],
          stack: [
            "LangGraph",
            "Speech-to-Text",
            "LLM scoring",
            "FastAPI",
            "PostgreSQL",
          ],
        },
        {
          slug: "document-ai",
          index: "02",
          status: "In development",
          tone: "development",
          dates: "Jun 2026 to present",
          title: "Multimodal Document AI for business PDFs",
          summary:
            "I am developing three pipelines that extract structured data from business PDFs and support both synchronous and asynchronous requests.",
          goal:
            "Extract structured data from mixed-layout and long business PDFs, with a clear recovery path when processing fails.",
          contribution:
            "I built page routing, structured extraction, validation, and long-document handling across three pipelines with Gemini, FastAPI, Pydantic, and PyMuPDF. Redis workers handle asynchronous jobs, retries, timeouts, failed-job queues, callbacks, redacted logs, and health checks.",
          outcome:
            "The current build has three document pipelines with synchronous and asynchronous APIs.",
          scope:
            "This work is still in development, so I do not describe it as production or claim UAT, accuracy, latency, or cost savings.",
          metrics: [
            { value: "3", label: "Document pipelines" },
            { value: "Sync + async", label: "Request modes" },
          ],
          stack: [
            "Google Gemini",
            "FastAPI",
            "Pydantic",
            "PyMuPDF",
            "Redis",
          ],
        },
        {
          slug: "lora-audit",
          index: "03",
          status: "Research completed",
          tone: "research",
          dates: "Jun 2026 to Aug 2026",
          title: "Backdoor audit for LoRA adapters",
          summary:
            "For my master’s internship, I built a prototype that screens LoRA adapters for backdoors before deployment.",
          goal:
            "Test whether adapter weights and trigger-blind behavior can identify backdoored LoRA adapters before deployment.",
          contribution:
            "I compared five weight-based features with trigger-blind behavioral probes on Qwen2.5-1.5B-Instruct using MASSIVE EN-VI. I kept validation and test lineages separate, fixed the decision threshold before testing, and checked provenance before including a run.",
          outcome:
            "The experiment included 36 clean/backdoored pairs. Twenty-five lineages passed quality control, and eight valid lineages entered the test set. The weight-only method performed best; learned fusion did not improve on it after 5,000 cluster-bootstrap replicates.",
          scope:
            "The result applies only to this model, task, and valid test set; it should not be read as production or open-world performance.",
          metrics: [
            { value: "0.96875", label: "AUROC on valid test" },
            { value: "0.975", label: "PR-AUC on valid test" },
            { value: "0.75", label: "MCC on valid test" },
            { value: "25", label: "Lineages passing QC" },
          ],
          stack: [
            "Python",
            "PyTorch",
            "Transformers / PEFT",
            "scikit-learn",
            "Qwen2.5",
          ],
        },
      ],
    },
    product: {
      eyebrow: "Personal product",
      name: "X Nhân",
      badge: "New",
      title: "A focused way to follow technology conversations on X.",
      body:
        "I like X and often use it to follow technology news, new products, and conversations across the industry. I built X Nhân to turn one specific question into a concise, source-linked reading path while keeping X as the place where the original posts live.",
      independence:
        "Independent personal project · Not affiliated with or endorsed by X Corp.",
      primary: "Try X Nhân",
      secondary: "Why I built it",
      flowLabel: "How X Nhân guides a research question",
      flow: [
        {
          index: "01",
          label: "Ask",
          text: "Start with one concrete technology question.",
        },
        {
          index: "02",
          label: "Find",
          text: "Surface relevant public posts through hosted web search.",
        },
        {
          index: "03",
          label: "Read",
          text: "Summarize key views and return to the original posts.",
        },
      ],
      proofsLabel: "Product principles",
      proofs: [
        {
          title: "Originals stay central",
          text: "Every accepted result links back to its original post on X.",
        },
        {
          title: "Unknown stays unknown",
          text: "Unavailable timestamps, relationships, and engagement are not invented.",
        },
        {
          title: "Built with guardrails",
          text: "Bounded inputs, validation, and rate limits run on the server.",
        },
      ],
    },
    contact: {
      eyebrow: "Contact",
      title: "Let’s talk",
      body:
        "If you are hiring for an AI engineering role or want to discuss one of these projects, email me or connect with me on LinkedIn or X.",
      location: "Ho Chi Minh City, Vietnam",
      links: [
        {
          label: "Email me",
          value: "tranthiennhan.work@gmail.com",
          href: "mailto:tranthiennhan.work@gmail.com",
        },
        {
          label: "View LinkedIn profile",
          value: "linkedin.com/in/clementtranbe",
          href: "https://www.linkedin.com/in/clementtranbe",
        },
        {
          label: "View X profile",
          value: "@tran_thien_nhan",
          href: "https://x.com/tran_thien_nhan",
        },
      ],
    },
    footer: {
      statement: "AI Engineer · Ho Chi Minh City, Vietnam",
      visitorCountLabel: "Website visits",
      visitorCountUnavailable: "Unavailable",
      rights: "Trần Thiện Nhân",
    },
    chat: {
      title: "Ask Nhân",
      status: {
        ready: "Ready",
        thinking: "Thinking",
        ai: "AI",
        fallback: "Built-in fallback",
        guardrail: "Public information only",
        rateLimited: "Try again shortly",
        cancelled: "Stopped",
      },
      close: "Close Ask Nhân",
      open: "Open Ask Nhân",
      newChat: "Start a new conversation",
      introduction:
        "Hi. You can ask about Nhân’s experience, projects, and how this website works.",
      transcriptLabel: "Conversation with Ask Nhân",
      suggestionsLabel: "Suggested questions",
      suggestions: [
        "What has Nhân shipped to production?",
        "How does the LoRA audit work?",
        "What is Nhân building for Document AI?",
      ],
      placeholder: "Ask about Nhân’s work…",
      send: "Send message",
      typing: "Ask Nhân is preparing an answer",
      waiting: "Preparing an answer · {seconds}s",
      stopWaiting: "Stop waiting",
      copyAnswer: "Copy answer",
      copied: "Copied",
      retry: "Try again",
      viewSection: "View {section}",
      rateLimited:
        "Ask Nhân has received several questions in a short time. Try again in a minute.",
      disclosure:
        "This site does not save questions, replies, or chat history; the conversation disappears when you reload. Visit and page-performance analytics never receive chat text. AI can be wrong. Check the linked sections and do not share sensitive information.",
      replies: {
        capability:
          "I can answer questions about Nhân’s work at KienlongBank and Mercedes-Benz Vietnam, Nhân’s three featured projects, education, and the technology behind this website.",
        profile:
          "Nhân is an AI Engineer and an R&D Solutions Specialist in Kien Long Bank’s Technology Division. Recent work includes a production call-scoring system, a Document AI platform in development, and completed research on LoRA backdoors.",
        production:
          "Nhân built and launched a speech-and-LLM system for scoring customer-service call quality. Customer Service uses its output to evaluate agents; the estimated reduction in annual operating cost is VND 180 million.",
        document:
          "Nhân is developing three Multimodal Document AI pipelines for structured extraction from business PDFs, including long documents. The platform supports synchronous and asynchronous requests but is not yet in production.",
        research:
          "During a master’s internship, Nhân built a prototype that looks for backdoors in LoRA adapters. On eight valid test lineages, the weight-only method reached AUROC 0.96875, PR-AUC 0.975, and MCC 0.75; adding learned fusion did not improve the result in the predefined evaluation.",
        build:
          "This website is built with React and Vite. Ask Nhân sends one bounded question at a time to an AI model, and the visible conversation stays only in the current page while it is open.",
        ai:
          "Ask Nhân sends one bounded question at a time to an AI model instructed to use only information published on this website. The site does not save questions, replies, or chat history. If the AI service is unavailable, a built-in answer appears with an option to try again.",
        fallback:
          "That information is not on the public website. Try asking about Nhân’s experience, call scoring, Document AI, LoRA research, or how this site works.",
      },
    },
  },
  vi: {
    meta: {
      title: "Trần Thiện Nhân · Kỹ sư AI",
      description:
        "Trần Thiện Nhân là kỹ sư AI, đã đưa hệ thống chấm điểm cuộc gọi vào vận hành, đang phát triển Document AI đa phương thức và đã hoàn thành nghiên cứu về backdoor trong LoRA.",
    },
    skip: "Đi đến nội dung chính",
    language: "Ngôn ngữ",
    brand: "Trần Thiện Nhân",
    nav: {
      primaryLabel: "Điều hướng chính",
      mobileLabel: "Điều hướng di động",
      about: "Cách tôi làm việc",
      experience: "Kinh nghiệm",
      work: "Dự án tiêu biểu",
      product: "X Nhân",
      contact: "Liên hệ",
      open: "Mở điều hướng",
      close: "Đóng điều hướng",
    },
    hero: {
      eyebrow: "Kỹ sư AI",
      role: "Kỹ sư AI · Hệ thống AI ứng dụng",
      statement:
        "Tôi làm việc cùng các đơn vị nghiệp vụ để biến yêu cầu thành luồng xử lý AI, API, bài kiểm thử và hệ thống có thể dùng trong công việc hằng ngày.",
      primary: "Xem dự án tiêu biểu",
      secondary: "Liên hệ với tôi",
      location: "TP. Hồ Chí Minh, Việt Nam",
      proofLabel: "Điểm nổi bật",
      proofs: [
        {
          value: "Đang vận hành",
          label: "Chấm điểm chất lượng cuộc gọi CSKH",
          note:
            "Đơn vị Dịch vụ Khách hàng dùng kết quả để đánh giá tổng đài viên. Hệ thống được ước tính giúp giảm 180 triệu đồng chi phí vận hành mỗi năm.",
        },
        {
          value: "3 luồng xử lý",
          label: "Document AI đa phương thức",
          note:
            "Có luồng xử lý đồng bộ và bất đồng bộ; hiện vẫn đang phát triển.",
        },
        {
          value: "AUROC 0.96875",
          label: "Nghiên cứu sàng lọc backdoor trong LoRA",
          note:
            "Phương pháp chỉ dùng đặc trưng trọng số, đo trên tám nhóm kiểm thử hợp lệ.",
        },
      ],
    },
    about: {
      eyebrow: "Cách tôi làm việc",
      title: "Cách tôi triển khai một dự án AI",
      body:
        "Trong công việc hiện tại, tôi phối hợp với đơn vị nghiệp vụ và phụ trách cả hệ thống xung quanh mô hình: làm rõ bài toán, xây luồng xử lý và API, kiểm thử tình huống lỗi và hỗ trợ tích hợp.",
      principles: [
        {
          index: "01",
          title: "Làm rõ yêu cầu",
          text:
            "Cùng đơn vị nghiệp vụ xác định dữ liệu đầu vào, kết quả cần trả về và kết quả đó sẽ được dùng ở đâu.",
        },
        {
          index: "02",
          title: "Xây luồng xử lý và API",
          text:
            "Thiết kế prompt, cấu trúc dữ liệu trả về và API; sau đó kết nối kết quả của mô hình với các hệ thống liên quan.",
        },
        {
          index: "03",
          title: "Kiểm thử tình huống lỗi",
          text:
            "Kiểm tra đầu ra, thử lại lỗi có thể phục hồi, tránh xử lý trùng và bổ sung nhật ký cùng cơ chế kiểm tra trạng thái hệ thống.",
        },
      ],
    },
    experience: {
      eyebrow: "Hồ sơ nghề nghiệp",
      title: "Kinh nghiệm và học vấn",
      intro:
        "Tôi hiện làm việc tại Khối Công nghệ, Ngân hàng TMCP Kiên Long. Trước đó, tôi thực tập CNTT tại Mercedes-Benz Việt Nam. Tôi tốt nghiệp ngành An toàn thông tin tại PTIT và đang theo học cao học ngành Hệ thống thông tin.",
      roles: [
        {
          role: "Chuyên viên Nghiên cứu và Phát triển giải pháp",
          organizationKey: "kienlongbank",
          organization: "KienlongBank",
          organizationDetail: "Khối Công nghệ · Ngân hàng TMCP Kiên Long",
          dates: "05.2025 đến nay",
          summary:
            "Tôi xây dựng các hệ thống AI cho nghiệp vụ ngân hàng, từ làm rõ yêu cầu đến tích hợp và kiểm thử.",
          highlights: [
            "Xây dựng và đưa hệ thống chấm điểm chất lượng cuộc gọi vào vận hành; đơn vị Dịch vụ Khách hàng đang dùng kết quả để đánh giá tổng đài viên.",
            "Thiết kế và triển khai ba luồng xử lý Document AI đa phương thức cho PDF nghiệp vụ; dự án hiện vẫn đang phát triển.",
          ],
          tags: [
            "GenAI",
            "Document AI",
            "AI giọng nói",
            "FastAPI",
            "Xử lý dữ liệu",
          ],
        },
        {
          role: "Thực tập sinh Công nghệ Thông tin",
          organizationKey: "mercedesBenz",
          organization: "Mercedes-Benz Việt Nam",
          organizationDetail: "Công nghệ Thông tin",
          dates: "08.2024 đến 02.2025",
          summary:
            "Hỗ trợ xử lý sự cố, bảo trì hệ thống và số hóa dữ liệu trong môi trường doanh nghiệp đa quốc gia.",
          highlights: [
            "Làm việc theo quy trình của doanh nghiệp và phối hợp công việc kỹ thuật bằng tiếng Anh.",
          ],
          tags: [
            "Vận hành CNTT",
            "Hỗ trợ sự cố",
            "Số hóa dữ liệu",
            "Phối hợp bằng tiếng Anh",
          ],
        },
      ],
      skillsLabel: "Kỹ năng và công nghệ",
      educationLabel: "Học vấn",
      educationInstitution: "Học viện Công nghệ Bưu chính Viễn thông",
      educationCampus: "Cơ sở Thành phố Hồ Chí Minh",
      education: [
        {
          degree: "Cao học · Hệ thống Thông tin",
          dates: "06.2025 đến nay",
        },
        {
          degree: "Kỹ sư · An toàn Thông tin",
          dates: "10.2020 đến 01.2025",
        },
      ],
      credentialsLabel: "Chứng chỉ và thành tích",
      credentials: [
        {
          title: "Google Cybersecurity Professional Certificate",
          detail: "Google / Coursera · 03.2024",
        },
        {
          title: "Giải Nhì Nghiên cứu Khoa học Sinh viên 2023",
          detail: "Nghiên cứu phát hiện web lừa đảo từ đặc trưng bố cục",
        },
        {
          title: "Học bổng Khuyến khích Học tập loại Xuất sắc",
          detail: "12.2024 · GPA học kỳ 3.79 / 4.00",
        },
      ],
      languagesLabel: "Ngôn ngữ",
      languages: [
        { name: "Tiếng Việt", level: "Bản ngữ" },
        {
          name: "Tiếng Anh",
          level: "Cận cao cấp",
        },
      ],
    },
    work: {
      eyebrow: "Dự án tiêu biểu",
      title: "Ba dự án AI tiêu biểu",
      intro:
        "Hệ thống chấm điểm cuộc gọi đã vận hành; Document AI đang phát triển; nghiên cứu LoRA đã hoàn thành. Mỗi dự án nêu rõ bài toán, phần tôi làm và trạng thái hiện tại.",
      labels: {
        index: "Danh mục dự án",
        period: "Thời gian thực hiện",
        goal: "Bài toán cần giải quyết",
        contribution: "Tôi đã làm gì",
        outcome: "Kết quả hiện tại",
        scope: "Điều cần lưu ý",
        metrics: "Con số chính",
        stack: "Công nghệ",
      },
      items: [
        {
          slug: "call-scoring",
          index: "01",
          status: "Đang vận hành",
          tone: "production",
          dates: "08.2025 đến 05.2026",
          title: "Chấm điểm chất lượng cuộc gọi chăm sóc khách hàng",
          summary:
            "Tôi xây một hệ thống kết hợp chuyển giọng nói thành văn bản và LLM để chấm cuộc gọi theo từng tiêu chí, kèm đoạn hội thoại hoặc tín hiệu kỹ thuật làm căn cứ.",
          goal:
            "Tự động chấm nhiều cuộc gọi hơn, nhưng mỗi điểm bị trừ vẫn phải truy được về đoạn hội thoại hoặc tín hiệu kỹ thuật cụ thể.",
          contribution:
            "Tôi dùng LangGraph để điều phối việc chuyển giọng nói thành văn bản, phân tách người nói và gán vai hội thoại, phân loại ý định rồi chấm theo từng tiêu chí. FastAPI cung cấp kết quả qua API, PostgreSQL lưu dữ liệu; luồng xử lý còn kiểm tra đầu ra, thử lại khi lỗi và tránh chạy trùng theo lô.",
          outcome:
            "Hệ thống đang vận hành và được đơn vị Dịch vụ Khách hàng dùng trong quy trình đánh giá tổng đài viên. Mức giảm chi phí vận hành được ước tính là 180 triệu đồng mỗi năm.",
          scope:
            "Phần này không đưa ra số liệu về độ chính xác, độ trễ hoặc UAT.",
          metrics: [
            {
              value: "180 triệu / năm",
              label: "Mức giảm chi phí ước tính",
            },
            {
              value: "Hội thoại hoặc tín hiệu",
              label: "Căn cứ cho mỗi điểm trừ",
            },
          ],
          stack: [
            "LangGraph",
            "Speech-to-Text",
            "LLM scoring",
            "FastAPI",
            "PostgreSQL",
          ],
        },
        {
          slug: "document-ai",
          index: "02",
          status: "Đang phát triển",
          tone: "development",
          dates: "06.2026 đến nay",
          title: "Document AI đa phương thức cho PDF nghiệp vụ",
          summary:
            "Tôi đang phát triển ba luồng xử lý để đọc PDF nghiệp vụ, trích xuất dữ liệu có cấu trúc và phục vụ cả yêu cầu đồng bộ lẫn bất đồng bộ.",
          goal:
            "Xử lý tài liệu dài và nhiều kiểu bố cục, đồng thời có phương án phục hồi rõ ràng khi một bước trích xuất thất bại.",
          contribution:
            "Tôi xây phần phân loại trang, trích xuất và kiểm tra dữ liệu, chuẩn hóa kết quả, chia và ghép tài liệu, rồi thêm phương án dự phòng cho tài liệu dài bằng Gemini, FastAPI, Pydantic và PyMuPDF. Hệ thống dùng Redis cùng worker bất đồng bộ để xử lý tác vụ, thử lại, giới hạn thời gian, hàng đợi lỗi và callback; đồng thời che dữ liệu nhạy cảm trong log và kiểm tra trạng thái dịch vụ.",
          outcome:
            "Bản hiện tại có ba luồng xử lý, với API đồng bộ và bất đồng bộ.",
          scope:
            "Dự án chưa được đưa vào vận hành; phần này không đưa ra số liệu về độ chính xác, độ trễ, UAT hoặc tiết kiệm chi phí.",
          metrics: [
            { value: "3", label: "Luồng xử lý tài liệu" },
            { value: "Đồng bộ + bất đồng bộ", label: "Cách xử lý yêu cầu" },
          ],
          stack: [
            "Google Gemini",
            "FastAPI",
            "Pydantic",
            "PyMuPDF",
            "Redis",
          ],
        },
        {
          slug: "lora-audit",
          index: "03",
          status: "Đã hoàn thành nghiên cứu",
          tone: "research",
          dates: "06.2026 đến 08.2026",
          title: "Phát hiện backdoor trong LoRA adapter",
          summary:
            "Trong kỳ thực tập tốt nghiệp cao học, tôi xây một bản thử nghiệm để phát hiện LoRA adapter bị cài backdoor trước khi triển khai.",
          goal:
            "Đánh giá xem đặc trưng trọng số và phép thử hành vi có thể nhận ra LoRA adapter bị cài backdoor hay không.",
          contribution:
            "Tôi so sánh năm đặc trưng từ trọng số với các phép thử hành vi không cần biết trước trigger trên Qwen2.5-1.5B-Instruct. Để tránh rò rỉ giữa tập xác thực và tập kiểm thử, tôi tách các nhóm mô hình có cùng nguồn gốc rồi chốt ngưỡng quyết định trước khi xem kết quả kiểm thử.",
          outcome:
            "Thực nghiệm gồm 36 cặp mô hình sạch và bị cài backdoor; 25 nhóm qua kiểm tra chất lượng. Trên tám nhóm kiểm thử hợp lệ, phương pháp dùng đặc trưng trọng số đạt AUROC 0.96875, PR-AUC 0.975 và MCC 0.75. Phương pháp learned fusion kết hợp tín hiệu hành vi không cải thiện so với cách chỉ dùng đặc trưng trọng số sau 5.000 lượt bootstrap theo cụm.",
          scope:
            "Kết quả chỉ cho biết phương pháp hoạt động thế nào trong thí nghiệm này; chưa đủ để kết luận về môi trường vận hành hoặc các loại backdoor ngoài phạm vi thử nghiệm.",
          metrics: [
            { value: "0.96875", label: "AUROC trên tập kiểm thử hợp lệ" },
            { value: "0.975", label: "PR-AUC trên tập kiểm thử hợp lệ" },
            { value: "0.75", label: "MCC trên tập kiểm thử hợp lệ" },
            { value: "25", label: "Nhóm qua kiểm tra chất lượng" },
          ],
          stack: [
            "Python",
            "PyTorch",
            "Transformers / PEFT",
            "scikit-learn",
            "Qwen2.5",
          ],
        },
      ],
    },
    product: {
      eyebrow: "Sản phẩm cá nhân",
      name: "X Nhân",
      badge: "Mới",
      title: "Một cách tập trung hơn để theo dõi các cuộc thảo luận công nghệ trên X.",
      body:
        "Tôi thích X và thường dùng nền tảng này để theo dõi tin tức, sản phẩm mới và các cuộc thảo luận trong ngành công nghệ. Tôi xây X Nhân để biến một câu hỏi cụ thể thành lộ trình đọc ngắn gọn, có liên kết nguồn, trong khi X vẫn là nơi nội dung gốc tồn tại.",
      independence:
        "Sản phẩm cá nhân độc lập · Không liên kết hoặc được X Corp. tài trợ hay xác nhận.",
      primary: "Dùng thử X Nhân",
      secondary: "Vì sao tôi xây nó",
      flowLabel: "Cách X Nhân dẫn một câu hỏi nghiên cứu",
      flow: [
        {
          index: "01",
          label: "Hỏi",
          text: "Bắt đầu bằng một câu hỏi công nghệ cụ thể.",
        },
        {
          index: "02",
          label: "Tìm",
          text: "Tìm các bài đăng công khai liên quan qua công cụ web search do nhà cung cấp vận hành.",
        },
        {
          index: "03",
          label: "Đọc",
          text: "Tóm lược góc nhìn chính và trở về các bài đăng gốc.",
        },
      ],
      proofsLabel: "Nguyên tắc sản phẩm",
      proofs: [
        {
          title: "Bài gốc luôn ở trung tâm",
          text: "Mỗi kết quả được chấp nhận đều dẫn về bài đăng gốc trên X.",
        },
        {
          title: "Không biết thì để trống",
          text: "Thời gian, quan hệ bài đăng và tương tác chưa có nguồn sẽ không được tự điền.",
        },
        {
          title: "Có kiểm soát phía máy chủ",
          text: "Đầu vào giới hạn, kiểm tra dữ liệu và giới hạn lượt dùng đều chạy phía máy chủ.",
        },
      ],
    },
    contact: {
      eyebrow: "Liên hệ",
      title: "Hãy cùng trao đổi",
      body:
        "Nếu bạn đang tuyển vị trí kỹ sư AI hoặc muốn trao đổi thêm về một trong các dự án trên, hãy liên hệ với tôi qua email, LinkedIn hoặc X.",
      location: "TP. Hồ Chí Minh, Việt Nam",
      links: [
        {
          label: "Gửi email",
          value: "tranthiennhan.work@gmail.com",
          href: "mailto:tranthiennhan.work@gmail.com",
        },
        {
          label: "Xem hồ sơ LinkedIn",
          value: "linkedin.com/in/clementtranbe",
          href: "https://www.linkedin.com/in/clementtranbe",
        },
        {
          label: "Xem hồ sơ X",
          value: "@tran_thien_nhan",
          href: "https://x.com/tran_thien_nhan",
        },
      ],
    },
    footer: {
      statement: "Kỹ sư AI · TP. Hồ Chí Minh, Việt Nam",
      visitorCountLabel: "Lượt truy cập website",
      visitorCountUnavailable: "Chưa khả dụng",
      rights: "Trần Thiện Nhân",
    },
    chat: {
      title: "Ask Nhân",
      status: {
        ready: "Sẵn sàng",
        thinking: "Đang trả lời",
        ai: "AI",
        fallback: "Câu trả lời có sẵn",
        guardrail: "Chỉ dùng thông tin công khai",
        rateLimited: "Vui lòng thử lại sau",
        cancelled: "Đã dừng",
      },
      close: "Đóng Ask Nhân",
      open: "Mở Ask Nhân",
      newChat: "Bắt đầu cuộc trò chuyện mới",
      introduction:
        "Chào bạn! Hãy hỏi tôi về kinh nghiệm, các dự án của Nhân hoặc cách website này được xây dựng.",
      transcriptLabel: "Cuộc trò chuyện với Ask Nhân",
      suggestionsLabel: "Câu hỏi gợi ý",
      suggestions: [
        "Nhân đã đưa hệ thống nào vào vận hành?",
        "Bộ kiểm toán LoRA hoạt động ra sao?",
        "Nhân đang xây gì cho Document AI?",
      ],
      placeholder: "Hỏi về công việc của Nhân…",
      send: "Gửi tin nhắn",
      typing: "Ask Nhân đang chuẩn bị câu trả lời",
      waiting: "Đang chuẩn bị câu trả lời · {seconds} giây",
      stopWaiting: "Dừng chờ",
      copyAnswer: "Sao chép câu trả lời",
      copied: "Đã sao chép",
      retry: "Thử lại",
      viewSection: "Xem mục {section}",
      rateLimited:
        "Ask Nhân vừa nhận nhiều câu hỏi trong thời gian ngắn. Hãy thử lại sau một phút.",
      disclosure:
        "Website không lưu câu hỏi, câu trả lời hay lịch sử trò chuyện; nội dung sẽ mất khi tải lại. Thống kê lượt truy cập và hiệu năng trang không nhận nội dung trò chuyện. AI có thể trả lời sai. Hãy kiểm tra các mục được dẫn và đừng gửi thông tin nhạy cảm.",
      replies: {
        capability:
          "Tôi có thể trả lời về công việc của Nhân tại KienlongBank và Mercedes-Benz Việt Nam, ba dự án tiêu biểu, học vấn và công nghệ của website này.",
        profile:
          "Nhân là kỹ sư AI, hiện giữ vị trí Chuyên viên Nghiên cứu và Phát triển giải pháp tại Khối Công nghệ, Ngân hàng TMCP Kiên Long. Gần đây, Nhân đã đưa hệ thống chấm điểm cuộc gọi vào vận hành, đang phát triển nền tảng Document AI và đã hoàn thành nghiên cứu về backdoor trong LoRA.",
        production:
          "Nhân đã xây dựng và đưa hệ thống Speech + LLM chấm điểm chất lượng cuộc gọi CSKH vào vận hành. Đơn vị Dịch vụ Khách hàng dùng kết quả để đánh giá tổng đài viên; mức giảm chi phí vận hành được ước tính là 180 triệu đồng mỗi năm.",
        document:
          "Nhân đang phát triển ba luồng xử lý Document AI đa phương thức để trích xuất dữ liệu từ PDF nghiệp vụ, kể cả tài liệu dài. Nền tảng hỗ trợ yêu cầu đồng bộ và bất đồng bộ nhưng chưa được đưa vào vận hành.",
        research:
          "Trong kỳ thực tập tốt nghiệp cao học, Nhân xây một bản thử nghiệm để phát hiện backdoor trong LoRA adapter. Trên tám nhóm kiểm thử hợp lệ, phương pháp dùng đặc trưng trọng số đạt AUROC 0.96875, PR-AUC 0.975 và MCC 0.75; phương pháp learned fusion kết hợp tín hiệu hành vi không cải thiện so với cách chỉ dùng đặc trưng trọng số trong quy trình đánh giá đã chốt trước.",
        build:
          "Website được xây bằng React và Vite. Ask Nhân gửi mỗi lần một câu hỏi có giới hạn đến mô hình AI; nội dung cuộc trò chuyện chỉ tồn tại trong trang hiện tại khi trang còn mở.",
        ai:
          "Ask Nhân gửi mỗi lần một câu hỏi có giới hạn đến mô hình AI với hướng dẫn chỉ dùng thông tin công khai trên website. Website không lưu câu hỏi, câu trả lời hay lịch sử trò chuyện. Nếu dịch vụ AI tạm thời không khả dụng, website hiển thị câu trả lời có sẵn và cho phép thử lại.",
        fallback:
          "Website chưa có thông tin đó. Bạn có thể hỏi về kinh nghiệm của Nhân, hệ thống chấm điểm cuộc gọi, Document AI, nghiên cứu LoRA hoặc cách website hoạt động.",
      },
    },
  },
};
