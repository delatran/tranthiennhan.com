import { content } from "../src/content.js";

const MAX_SELECTED_FACTS = 4;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  // Evidence points at the shared, language-specific content tree.  Freezing
  // the catalog must not freeze that application content object (or its
  // arrays), otherwise an unrelated renderer can no longer update its own
  // view model in development/tests.  The evidence values are still treated
  // as immutable by the closed renderer; they are deliberately not mutated by
  // this catalog freezer.
  for (const [key, child] of Object.entries(value)) {
    if (key === "evidence") continue;
    deepFreeze(child);
  }
  return Object.freeze(value);
}

const FACT_SOURCE_REFS = deepFreeze({
  "profile.role.ai_engineer": ["en.hero.role", "vi.hero.role"],
  "profile.location.public_listing": ["en.hero.location", "vi.hero.location"],
  "approach.end_to_end": ["en.hero.statement", "en.about.body", "vi.hero.statement", "vi.about.body"],
  "approach.reliability": ["en.about.principles[2].text", "vi.about.principles[2].text"],
  "employment.kienlong.current_role": ["en.experience.roles[0]", "vi.experience.roles[0]"],
  "employment.mercedes.it_internship": ["en.experience.roles[1]", "vi.experience.roles[1]"],
  "employment.mercedes.responsibilities": [
    "en.experience.roles[1].summary",
    "en.experience.roles[1].highlights",
    "vi.experience.roles[1].summary",
    "vi.experience.roles[1].highlights",
  ],
  "education.masters.information_systems.current": [
    "en.experience.intro",
    "en.experience.educationInstitution",
    "en.experience.education[0]",
    "vi.experience.intro",
    "vi.experience.educationInstitution",
    "vi.experience.education[0]",
  ],
  "education.beng.information_security.completed": [
    "en.experience.intro",
    "en.experience.educationInstitution",
    "en.experience.education[1]",
    "vi.experience.intro",
    "vi.experience.educationInstitution",
    "vi.experience.education[1]",
  ],
  "credential.google_cybersecurity.mar_2024": ["en.experience.credentials[0]", "vi.experience.credentials[0]"],
  "award.student_research.second_2023": ["en.experience.credentials[1]", "vi.experience.credentials[1]"],
  "award.scholarship.excellence_dec_2024": ["en.experience.credentials[2]", "vi.experience.credentials[2]"],
  "language.vietnamese.native": ["en.experience.languages[0]", "vi.experience.languages[0]"],
  "language.english.upper_intermediate": ["en.experience.languages[1]", "vi.experience.languages[1]"],
  "call_scoring.workflow.traceable": [
    "en.work.items[0].summary",
    "en.work.items[0].goal",
    "vi.work.items[0].summary",
    "vi.work.items[0].goal",
  ],
  "call_scoring.status.production": [
    "en.work.items[0].status",
    "en.work.items[0].outcome",
    "vi.work.items[0].status",
    "vi.work.items[0].outcome",
  ],
  "call_scoring.cost_reduction.estimated_180m_vnd_year": [
    "en.work.items[0].outcome",
    "en.work.items[0].metrics[0]",
    "vi.work.items[0].outcome",
    "vi.work.items[0].metrics[0]",
  ],
  "call_scoring.metric.accuracy_not_published": ["en.work.items[0].scope", "vi.work.items[0].scope"],
  "call_scoring.metric.latency_not_published": ["en.work.items[0].scope", "vi.work.items[0].scope"],
  "call_scoring.metric.uat_not_published": ["en.work.items[0].scope", "vi.work.items[0].scope"],
  "call_scoring.pipeline.reliability": ["en.work.items[0].contribution", "vi.work.items[0].contribution"],
  "document_ai.pipeline.three_business_pdf": [
    "en.work.items[1].title",
    "en.work.items[1].summary",
    "en.work.items[1].metrics[0]",
    "vi.work.items[1].title",
    "vi.work.items[1].summary",
    "vi.work.items[1].metrics[0]",
  ],
  "document_ai.request_modes.sync_async": [
    "en.work.items[1].outcome",
    "en.work.items[1].metrics[1]",
    "vi.work.items[1].outcome",
    "vi.work.items[1].metrics[1]",
  ],
  "document_ai.status.development": ["en.work.items[1].status", "vi.work.items[1].status"],
  "document_ai.status.not_production": ["en.work.items[1].scope", "vi.work.items[1].scope"],
  "document_ai.metric.accuracy_not_published": ["en.work.items[1].scope", "vi.work.items[1].scope"],
  "document_ai.metric.latency_not_published": ["en.work.items[1].scope", "vi.work.items[1].scope"],
  "document_ai.metric.uat_not_published": ["en.work.items[1].scope", "vi.work.items[1].scope"],
  "document_ai.metric.cost_saving_not_published": ["en.work.items[1].scope", "vi.work.items[1].scope"],
  "document_ai.reliability.async_workers": ["en.work.items[1].contribution", "vi.work.items[1].contribution"],
  "lora.prototype.backdoor_screening": ["en.work.items[2].summary", "vi.work.items[2].summary"],
  "lora.experiment.pairs_36": ["en.work.items[2].outcome", "vi.work.items[2].outcome"],
  "lora.experiment.qc_lineages_25": [
    "en.work.items[2].outcome",
    "en.work.items[2].metrics[3]",
    "vi.work.items[2].outcome",
    "vi.work.items[2].metrics[3]",
  ],
  "lora.experiment.valid_test_lineages_8": ["en.work.items[2].outcome", "vi.work.items[2].outcome"],
  "lora.metric.auroc_0_96875": ["en.chat.replies.research", "en.work.items[2].outcome", "en.work.items[2].metrics[0]", "vi.chat.replies.research", "vi.work.items[2].outcome", "vi.work.items[2].metrics[0]"],
  "lora.metric.pr_auc_0_975": ["en.chat.replies.research", "en.work.items[2].outcome", "en.work.items[2].metrics[1]", "vi.chat.replies.research", "vi.work.items[2].outcome", "vi.work.items[2].metrics[1]"],
  "lora.metric.mcc_0_75": ["en.chat.replies.research", "en.work.items[2].outcome", "en.work.items[2].metrics[2]", "vi.chat.replies.research", "vi.work.items[2].outcome", "vi.work.items[2].metrics[2]"],
  "lora.fusion.no_improvement_5000_bootstrap": ["en.work.items[2].outcome", "vi.work.items[2].outcome"],
  "lora.status.research_completed": ["en.work.items[2].status", "vi.work.items[2].status"],
  "lora.status.not_production": ["en.work.items[2].scope", "vi.work.items[2].scope"],
  "lora.scope.not_open_world": ["en.work.items[2].scope", "vi.work.items[2].scope"],
  "site.interface.react_vite": ["en.chat.replies.build", "vi.chat.replies.build"],
  "site.ask.one_question_no_chat_persistence": ["en.chat.replies.ai", "vi.chat.replies.ai"],
  "site.ask.predefined_fallback": ["en.chat.replies.ai", "vi.chat.replies.ai"],
  "contact.public_section": ["en.contact.body", "en.contact.links", "vi.contact.body", "vi.contact.links"],
});

function fact({ id, subject, predicate, object, qualifiers = {}, polarity = "positive", metric = null, planner, en, vi, evidence }) {
  const sourceRefs = FACT_SOURCE_REFS[id];
  if (!sourceRefs) throw new Error(`missing_fact_source_refs:${id}`);
  return deepFreeze({
    id,
    assertion: { subject, predicate, object, qualifiers, polarity, metric },
    planner,
    renderings: { en, vi },
    evidence,
    sourceRefs,
  });
}

const en = content.en;
const vi = content.vi;

export const ASK_FACTS = deepFreeze([
  fact({
    id: "profile.role.ai_engineer",
    subject: "Trần Thiện Nhân",
    predicate: "holds_public_role",
    object: "AI Engineer",
    qualifiers: { focus: "applied AI systems" },
    planner: "Nhân's public role is AI Engineer, focused on applied AI systems.",
    en: "Nhân is an AI Engineer focused on applied AI systems.",
    vi: "Nhân là kỹ sư AI tập trung vào các hệ thống AI ứng dụng.",
    evidence: [en.hero.role, vi.hero.role],
  }),
  fact({
    id: "profile.location.public_listing",
    subject: "public portfolio",
    predicate: "lists_location_for",
    object: "Trần Thiện Nhân",
    qualifiers: { location: "Ho Chi Minh City, Vietnam", not_residence_or_nationality: true },
    planner: "The portfolio lists Ho Chi Minh City, Vietnam as Nhân's public location; this does not establish residence or nationality.",
    en: "The portfolio lists Nhân’s location as Ho Chi Minh City, Vietnam.",
    vi: "Portfolio ghi địa điểm của Nhân là Thành phố Hồ Chí Minh, Việt Nam.",
    evidence: [en.hero.location, vi.hero.location],
  }),
  fact({
    id: "approach.end_to_end",
    subject: "Trần Thiện Nhân",
    predicate: "works_end_to_end_with",
    object: "business teams",
    qualifiers: { stages: ["requirements", "AI workflows", "APIs", "tests", "integration"] },
    planner: "Nhân works with business teams from requirements through AI workflows, APIs, tests, and integration.",
    en: "Nhân works with business teams from requirements through AI workflows, APIs, tests, and integration.",
    vi: "Nhân phối hợp với đơn vị nghiệp vụ từ khâu làm rõ yêu cầu đến luồng AI, API, kiểm thử và tích hợp.",
    evidence: [en.hero.statement, en.about.body, vi.hero.statement, vi.about.body],
  }),
  fact({
    id: "approach.reliability",
    subject: "Trần Thiện Nhân",
    predicate: "tests_and_supports",
    object: "AI service failure paths",
    qualifiers: { practices: ["output validation", "recoverable retries", "duplicate prevention", "logs", "health checks"] },
    planner: "Nhân validates outputs, retries recoverable failures, prevents duplicate work, and adds logs and health checks.",
    en: "Nhân validates outputs, retries recoverable failures, prevents duplicate work, and adds logs and health checks.",
    vi: "Nhân kiểm tra đầu ra, thử lại lỗi có thể phục hồi, tránh xử lý trùng và bổ sung log cùng health check.",
    evidence: [en.about.principles[2].text, vi.about.principles[2].text],
  }),
  fact({
    id: "employment.kienlong.current_role",
    subject: "Trần Thiện Nhân",
    predicate: "works_as",
    object: "R&D Solutions Specialist",
    qualifiers: { employer: "KienlongBank", division: "Technology Division", start: "May 2025", status: "current" },
    planner: "Nhân currently works as an R&D Solutions Specialist in KienlongBank's Technology Division, starting May 2025.",
    en: "Nhân has worked as an R&D Solutions Specialist in KienlongBank’s Technology Division since May 2025.",
    vi: "Nhân làm Chuyên viên Nghiên cứu và Phát triển giải pháp tại Khối Công nghệ của KienlongBank từ tháng 5 năm 2025 đến nay.",
    evidence: [en.experience.roles[0], vi.experience.roles[0]],
  }),
  fact({
    id: "employment.mercedes.it_internship",
    subject: "Trần Thiện Nhân",
    predicate: "completed_internship_as",
    object: "Information Technology Intern",
    qualifiers: { employer: "Mercedes-Benz Vietnam", start: "August 2024", end: "February 2025" },
    planner: "Nhân completed an Information Technology internship at Mercedes-Benz Vietnam from August 2024 to February 2025.",
    en: "Nhân completed an Information Technology internship at Mercedes-Benz Vietnam from August 2024 to February 2025.",
    vi: "Nhân thực tập Công nghệ Thông tin tại Mercedes-Benz Việt Nam từ tháng 8 năm 2024 đến tháng 2 năm 2025.",
    evidence: [en.experience.roles[1], vi.experience.roles[1]],
  }),
  fact({
    id: "employment.mercedes.responsibilities",
    subject: "Trần Thiện Nhân",
    predicate: "supported",
    object: "enterprise IT operations",
    qualifiers: { work: ["incident handling", "system maintenance", "data digitization", "English coordination"] },
    planner: "During the Mercedes-Benz Vietnam internship, Nhân supported incident handling, system maintenance, data digitization, and English coordination.",
    en: "During the Mercedes-Benz Vietnam internship, Nhân supported incidents, system maintenance, data digitization, and technical coordination in English.",
    vi: "Trong kỳ thực tập tại Mercedes-Benz Việt Nam, Nhân hỗ trợ xử lý sự cố, bảo trì hệ thống, số hóa dữ liệu và phối hợp kỹ thuật bằng tiếng Anh.",
    evidence: [en.experience.roles[1].summary, en.experience.roles[1].highlights, vi.experience.roles[1].summary, vi.experience.roles[1].highlights],
  }),
  fact({
    id: "education.masters.information_systems.current",
    subject: "Trần Thiện Nhân",
    predicate: "pursues_degree",
    object: "Master's degree in Information Systems",
    qualifiers: { institution: "PTIT", start: "June 2025", status: "current", earned: false },
    planner: "Nhân is pursuing a master's degree in Information Systems at PTIT since June 2025; the degree is not described as earned.",
    en: "Nhân is pursuing a master’s degree in Information Systems at PTIT and has studied there since June 2025.",
    vi: "Nhân theo học chương trình thạc sĩ Hệ thống Thông tin tại PTIT từ tháng 6 năm 2025 đến nay.",
    evidence: [en.experience.intro, en.experience.educationInstitution, en.experience.education[0], vi.experience.intro, vi.experience.educationInstitution, vi.experience.education[0]],
  }),
  fact({
    id: "education.beng.information_security.completed",
    subject: "Trần Thiện Nhân",
    predicate: "completed_degree",
    object: "B.Eng. in Information Security",
    qualifiers: { institution: "PTIT", start: "October 2020", end: "January 2025" },
    planner: "Nhân completed a B.Eng. in Information Security at PTIT, studied from October 2020 to January 2025.",
    en: "Nhân completed a B.Eng. in Information Security at PTIT after studying from October 2020 to January 2025.",
    vi: "Nhân hoàn thành bằng Kỹ sư An toàn Thông tin tại PTIT sau thời gian học từ tháng 10 năm 2020 đến tháng 1 năm 2025.",
    evidence: [en.experience.intro, en.experience.educationInstitution, en.experience.education[1], vi.experience.intro, vi.experience.educationInstitution, vi.experience.education[1]],
  }),
  fact({
    id: "credential.google_cybersecurity.mar_2024",
    subject: "Trần Thiện Nhân",
    predicate: "holds_credential",
    object: "Google Cybersecurity Professional Certificate",
    qualifiers: { issuer: "Google / Coursera", date: "March 2024" },
    planner: "Nhân holds the Google Cybersecurity Professional Certificate from Google/Coursera, dated March 2024.",
    en: "Nhân holds the Google Cybersecurity Professional Certificate from Google and Coursera, dated March 2024.",
    vi: "Nhân có Chứng chỉ Chuyên nghiệp An ninh mạng của Google và Coursera, cấp tháng 3 năm 2024.",
    evidence: [en.experience.credentials[0], vi.experience.credentials[0]],
  }),
  fact({
    id: "award.student_research.second_2023",
    subject: "Trần Thiện Nhân",
    predicate: "received_award",
    object: "Second Prize in the 2023 Student Research Award",
    qualifiers: { topic: "phishing detection using layout features" },
    planner: "Nhân received Second Prize in the 2023 Student Research Award for phishing detection using layout features.",
    en: "Nhân received Second Prize in the 2023 Student Research Award for phishing detection using layout features.",
    vi: "Nhân giành Giải Nhì Nghiên cứu Khoa học Sinh viên năm 2023 với đề tài phát hiện web lừa đảo từ đặc trưng bố cục.",
    evidence: [en.experience.credentials[1], vi.experience.credentials[1]],
  }),
  fact({
    id: "award.scholarship.excellence_dec_2024",
    subject: "Trần Thiện Nhân",
    predicate: "received_scholarship",
    object: "Academic Excellence Scholarship",
    qualifiers: { date: "December 2024" },
    metric: { name: "semester GPA", value: 3.79, unit: "out of 4.00" },
    planner: "Nhân received an Academic Excellence Scholarship in December 2024, with a semester GPA of 3.79/4.00.",
    en: "Nhân received an Academic Excellence Scholarship in December 2024, with a semester GPA of 3.79 out of 4.00.",
    vi: "Nhân nhận Học bổng Khuyến khích Học tập loại Xuất sắc tháng 12 năm 2024, với GPA học kỳ 3,79 trên 4,00.",
    evidence: [en.experience.credentials[2], vi.experience.credentials[2]],
  }),
  fact({
    id: "language.vietnamese.native",
    subject: "Trần Thiện Nhân",
    predicate: "has_language_level",
    object: "Vietnamese",
    qualifiers: { level: "native" },
    planner: "Nhân's Vietnamese level is native.",
    en: "Nhân’s Vietnamese level is native.",
    vi: "Tiếng Việt của Nhân ở trình độ bản ngữ.",
    evidence: [en.experience.languages[0], vi.experience.languages[0]],
  }),
  fact({
    id: "language.english.upper_intermediate",
    subject: "Trần Thiện Nhân",
    predicate: "has_language_level",
    object: "English",
    qualifiers: { level: "upper-intermediate" },
    planner: "Nhân's English level is upper-intermediate.",
    en: "Nhân’s English level is upper-intermediate.",
    vi: "Tiếng Anh của Nhân ở trình độ cận cao cấp.",
    evidence: [en.experience.languages[1], vi.experience.languages[1]],
  }),
  fact({
    id: "call_scoring.workflow.traceable",
    subject: "Trần Thiện Nhân",
    predicate: "built",
    object: "customer-service call-quality scoring workflow",
    qualifiers: { components: ["speech processing", "LLM scoring"], traceability: "transcript passage or technical signal for each deduction" },
    planner: "Nhân built a speech-and-LLM customer-service call-quality scoring workflow with traceable evidence for each deduction.",
    en: "Nhân built a speech-and-LLM customer-service call-quality scoring workflow with traceable evidence for each deduction.",
    vi: "Nhân xây hệ thống chấm điểm chất lượng cuộc gọi chăm sóc khách hàng bằng xử lý giọng nói và LLM, với căn cứ truy vết cho từng điểm trừ.",
    evidence: [en.work.items[0].summary, en.work.items[0].goal, vi.work.items[0].summary, vi.work.items[0].goal],
  }),
  fact({
    id: "call_scoring.status.production",
    subject: "customer-service call-quality scoring system",
    predicate: "has_status",
    object: "production",
    qualifiers: { user: "Customer Service", use: "agent-evaluation process" },
    planner: "The call-scoring system is in production, and Customer Service uses its output to evaluate agents.",
    en: "The call-scoring system is in production, and Customer Service uses its output to evaluate agents.",
    vi: "Hệ thống chấm điểm cuộc gọi đang vận hành, và đơn vị Dịch vụ Khách hàng dùng kết quả để đánh giá tổng đài viên.",
    evidence: [en.work.items[0].status, en.work.items[0].outcome, vi.work.items[0].status, vi.work.items[0].outcome],
  }),
  fact({
    id: "call_scoring.cost_reduction.estimated_180m_vnd_year",
    subject: "customer-service call-quality scoring system",
    predicate: "has_estimated_cost_reduction",
    object: "annual operating cost",
    qualifiers: { estimate: true },
    metric: { name: "operating-cost reduction", value: 180, unit: "million VND per year" },
    planner: "The call-scoring system has an estimated annual operating-cost reduction of VND 180 million; this is not an accuracy percentage.",
    en: "The call-scoring system’s estimated annual operating-cost reduction is VND 180 million.",
    vi: "Mức giảm chi phí vận hành hằng năm ước tính của hệ thống chấm điểm cuộc gọi là 180 triệu đồng.",
    evidence: [en.work.items[0].outcome, en.work.items[0].metrics[0], vi.work.items[0].outcome, vi.work.items[0].metrics[0]],
  }),
  fact({
    id: "call_scoring.metric.accuracy_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "call-scoring accuracy",
    polarity: "negative",
    planner: "The portfolio does not publish an accuracy figure for the call-scoring system.",
    en: "The portfolio does not publish an accuracy figure for the call-scoring system.",
    vi: "Portfolio không công bố số liệu độ chính xác của hệ thống chấm điểm cuộc gọi.",
    evidence: [en.work.items[0].scope, vi.work.items[0].scope],
  }),
  fact({
    id: "call_scoring.metric.latency_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "call-scoring latency",
    polarity: "negative",
    planner: "The portfolio does not publish a latency figure for the call-scoring system.",
    en: "The portfolio does not publish a latency figure for the call-scoring system.",
    vi: "Portfolio không công bố số liệu độ trễ của hệ thống chấm điểm cuộc gọi.",
    evidence: [en.work.items[0].scope, vi.work.items[0].scope],
  }),
  fact({
    id: "call_scoring.metric.uat_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "call-scoring UAT",
    polarity: "negative",
    planner: "The portfolio does not publish a UAT figure for the call-scoring system.",
    en: "The portfolio does not publish a UAT figure for the call-scoring system.",
    vi: "Portfolio không công bố số liệu UAT của hệ thống chấm điểm cuộc gọi.",
    evidence: [en.work.items[0].scope, vi.work.items[0].scope],
  }),
  fact({
    id: "call_scoring.pipeline.reliability",
    subject: "customer-service call-quality scoring workflow",
    predicate: "implements",
    object: "reliable structured processing",
    qualifiers: { practices: ["validation", "recoverable retries", "duplicate-batch prevention"] },
    planner: "The call-scoring workflow validates structured output, retries recoverable failures, and prevents duplicate batch processing.",
    en: "The call-scoring workflow validates structured output, retries recoverable failures, and prevents duplicate batch processing.",
    vi: "Luồng chấm điểm cuộc gọi kiểm tra đầu ra có cấu trúc, thử lại lỗi có thể phục hồi và tránh xử lý trùng theo lô.",
    evidence: [en.work.items[0].contribution, vi.work.items[0].contribution],
  }),
  fact({
    id: "document_ai.pipeline.three_business_pdf",
    subject: "Trần Thiện Nhân",
    predicate: "is_developing",
    object: "multimodal Document AI pipelines for business PDFs",
    qualifiers: { status: "development" },
    metric: { name: "document pipelines", value: 3, unit: "pipelines" },
    planner: "Nhân is developing three multimodal Document AI pipelines for structured extraction from business PDFs.",
    en: "Nhân is developing three multimodal Document AI pipelines for structured extraction from business PDFs.",
    vi: "Nhân đang phát triển ba luồng Document AI đa phương thức để trích xuất dữ liệu có cấu trúc từ PDF nghiệp vụ.",
    evidence: [en.work.items[1].title, en.work.items[1].summary, en.work.items[1].metrics[0], vi.work.items[1].title, vi.work.items[1].summary, vi.work.items[1].metrics[0]],
  }),
  fact({
    id: "document_ai.request_modes.sync_async",
    subject: "Document AI platform",
    predicate: "supports_request_modes",
    object: "synchronous and asynchronous APIs",
    planner: "The current Document AI build supports synchronous and asynchronous APIs.",
    en: "The current Document AI build supports synchronous and asynchronous APIs.",
    vi: "Bản Document AI hiện tại hỗ trợ API đồng bộ và bất đồng bộ.",
    evidence: [en.work.items[1].outcome, en.work.items[1].metrics[1], vi.work.items[1].outcome, vi.work.items[1].metrics[1]],
  }),
  fact({
    id: "document_ai.status.development",
    subject: "Document AI project",
    predicate: "has_status",
    object: "development",
    planner: "The Document AI project is still in development.",
    en: "The Document AI project is still in development.",
    vi: "Dự án Document AI vẫn đang trong giai đoạn phát triển.",
    evidence: [en.work.items[1].status, vi.work.items[1].status],
  }),
  fact({
    id: "document_ai.status.not_production",
    subject: "Document AI project",
    predicate: "does_not_have_status",
    object: "production",
    polarity: "negative",
    planner: "The Document AI project is not in production.",
    en: "The Document AI project is not in production.",
    vi: "Dự án Document AI chưa được đưa vào vận hành.",
    evidence: [en.work.items[1].scope, vi.work.items[1].scope],
  }),
  fact({
    id: "document_ai.metric.accuracy_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "Document AI accuracy",
    polarity: "negative",
    planner: "The portfolio does not publish an accuracy figure for Document AI.",
    en: "The portfolio does not publish an accuracy figure for Document AI.",
    vi: "Portfolio không công bố số liệu độ chính xác cho Document AI.",
    evidence: [en.work.items[1].scope, vi.work.items[1].scope],
  }),
  fact({
    id: "document_ai.metric.latency_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "Document AI latency",
    polarity: "negative",
    planner: "The portfolio does not publish a latency figure for Document AI.",
    en: "The portfolio does not publish a latency figure for Document AI.",
    vi: "Portfolio không công bố số liệu độ trễ cho Document AI.",
    evidence: [en.work.items[1].scope, vi.work.items[1].scope],
  }),
  fact({
    id: "document_ai.metric.uat_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "Document AI UAT",
    polarity: "negative",
    planner: "The portfolio does not publish a UAT result for Document AI.",
    en: "The portfolio does not publish a UAT result for Document AI.",
    vi: "Portfolio không công bố kết quả UAT cho Document AI.",
    evidence: [en.work.items[1].scope, vi.work.items[1].scope],
  }),
  fact({
    id: "document_ai.metric.cost_saving_not_published",
    subject: "public portfolio",
    predicate: "does_not_publish_metric",
    object: "Document AI cost savings",
    polarity: "negative",
    planner: "The portfolio does not claim cost savings for Document AI.",
    en: "The portfolio does not claim cost savings for Document AI.",
    vi: "Portfolio không tuyên bố mức tiết kiệm chi phí cho Document AI.",
    evidence: [en.work.items[1].scope, vi.work.items[1].scope],
  }),
  fact({
    id: "document_ai.reliability.async_workers",
    subject: "Document AI platform",
    predicate: "implements",
    object: "asynchronous reliability controls",
    qualifiers: { controls: ["retries", "timeouts", "failed-job queues", "callbacks", "redacted logs", "health checks"] },
    planner: "Document AI uses asynchronous workers with retries, timeouts, failed-job queues, callbacks, redacted logs, and health checks.",
    en: "Document AI uses asynchronous workers with retries, timeouts, failed-job queues, callbacks, redacted logs, and health checks.",
    vi: "Document AI dùng worker bất đồng bộ với retry, timeout, hàng đợi lỗi, callback, log đã che dữ liệu và health check.",
    evidence: [en.work.items[1].contribution, vi.work.items[1].contribution],
  }),
  fact({
    id: "lora.prototype.backdoor_screening",
    subject: "Trần Thiện Nhân",
    predicate: "built",
    object: "prototype for LoRA backdoor screening",
    qualifiers: { context: "master's internship", stage: "before deployment" },
    planner: "During a master's internship, Nhân built a prototype to screen LoRA adapters for backdoors before deployment.",
    en: "During a master’s internship, Nhân built a prototype to screen LoRA adapters for backdoors before deployment.",
    vi: "Trong kỳ thực tập cao học, Nhân xây bản thử nghiệm để sàng lọc LoRA adapter bị cài backdoor trước khi triển khai.",
    evidence: [en.work.items[2].summary, vi.work.items[2].summary],
  }),
  fact({
    id: "lora.experiment.pairs_36",
    subject: "LoRA experiment",
    predicate: "included",
    object: "clean/backdoored model pairs",
    metric: { name: "model pairs", value: 36, unit: "pairs" },
    planner: "The LoRA experiment included 36 clean/backdoored model pairs.",
    en: "The LoRA experiment included 36 clean and backdoored model pairs.",
    vi: "Thực nghiệm LoRA gồm 36 cặp mô hình sạch và bị cài backdoor.",
    evidence: [en.work.items[2].outcome, vi.work.items[2].outcome],
  }),
  fact({
    id: "lora.experiment.qc_lineages_25",
    subject: "LoRA experiment",
    predicate: "passed_quality_control",
    object: "model lineages",
    metric: { name: "lineages passing quality control", value: 25, unit: "lineages" },
    planner: "Twenty-five LoRA experiment lineages passed quality control.",
    en: "Twenty-five LoRA experiment lineages passed quality control.",
    vi: "Có 25 nhóm mô hình trong thực nghiệm LoRA vượt qua kiểm tra chất lượng.",
    evidence: [en.work.items[2].outcome, en.work.items[2].metrics[3], vi.work.items[2].outcome, vi.work.items[2].metrics[3]],
  }),
  fact({
    id: "lora.experiment.valid_test_lineages_8",
    subject: "LoRA experiment",
    predicate: "used_for_test",
    object: "valid model lineages",
    metric: { name: "valid test lineages", value: 8, unit: "lineages" },
    planner: "Eight valid LoRA experiment lineages entered the test set.",
    en: "Eight valid LoRA experiment lineages entered the test set.",
    vi: "Tám nhóm mô hình hợp lệ của thực nghiệm LoRA được đưa vào tập kiểm thử.",
    evidence: [en.work.items[2].outcome, vi.work.items[2].outcome],
  }),
  fact({
    id: "lora.metric.auroc_0_96875",
    subject: "LoRA weight-only method",
    predicate: "achieved_metric",
    object: "AUROC",
    qualifiers: { dataset: "eight valid test lineages" },
    metric: { name: "AUROC", value: 0.96875, unit: "score" },
    planner: "On eight valid test lineages, the LoRA weight-only method achieved AUROC 0.96875.",
    en: "On eight valid test lineages, the LoRA weight-only method achieved AUROC 0.96875.",
    vi: "Trên tám nhóm kiểm thử hợp lệ, phương pháp LoRA chỉ dùng trọng số đạt AUROC 0,96875.",
    evidence: [en.chat.replies.research, en.work.items[2].outcome, en.work.items[2].metrics[0], vi.chat.replies.research, vi.work.items[2].outcome, vi.work.items[2].metrics[0]],
  }),
  fact({
    id: "lora.metric.pr_auc_0_975",
    subject: "LoRA weight-only method",
    predicate: "achieved_metric",
    object: "PR-AUC",
    qualifiers: { dataset: "eight valid test lineages" },
    metric: { name: "PR-AUC", value: 0.975, unit: "score" },
    planner: "On eight valid test lineages, the LoRA weight-only method achieved PR-AUC 0.975.",
    en: "On eight valid test lineages, the LoRA weight-only method achieved PR-AUC 0.975.",
    vi: "Trên tám nhóm kiểm thử hợp lệ, phương pháp LoRA chỉ dùng trọng số đạt PR-AUC 0,975.",
    evidence: [en.chat.replies.research, en.work.items[2].outcome, en.work.items[2].metrics[1], vi.chat.replies.research, vi.work.items[2].outcome, vi.work.items[2].metrics[1]],
  }),
  fact({
    id: "lora.metric.mcc_0_75",
    subject: "LoRA weight-only method",
    predicate: "achieved_metric",
    object: "MCC",
    qualifiers: { dataset: "eight valid test lineages" },
    metric: { name: "MCC", value: 0.75, unit: "score" },
    planner: "On eight valid test lineages, the LoRA weight-only method achieved MCC 0.75.",
    en: "On eight valid test lineages, the LoRA weight-only method achieved MCC 0.75.",
    vi: "Trên tám nhóm kiểm thử hợp lệ, phương pháp LoRA chỉ dùng trọng số đạt MCC 0,75.",
    evidence: [en.chat.replies.research, en.work.items[2].outcome, en.work.items[2].metrics[2], vi.chat.replies.research, vi.work.items[2].outcome, vi.work.items[2].metrics[2]],
  }),
  fact({
    id: "lora.fusion.no_improvement_5000_bootstrap",
    subject: "learned-fusion method",
    predicate: "did_not_improve_over",
    object: "LoRA weight-only method",
    qualifiers: { bootstrap: "cluster", replicates: 5000 },
    polarity: "negative",
    metric: { name: "cluster-bootstrap replicates", value: 5000, unit: "replicates" },
    planner: "After 5,000 cluster-bootstrap replicates, learned fusion did not improve on the LoRA weight-only method; 5,000 is not a test-lineage count.",
    en: "After 5,000 cluster-bootstrap replicates, learned fusion did not improve on the LoRA weight-only method.",
    vi: "Sau 5.000 lượt bootstrap theo cụm, learned fusion không cải thiện so với phương pháp LoRA chỉ dùng trọng số.",
    evidence: [en.work.items[2].outcome, vi.work.items[2].outcome],
  }),
  fact({
    id: "lora.status.research_completed",
    subject: "LoRA audit",
    predicate: "has_status",
    object: "research completed",
    planner: "The LoRA audit is completed research.",
    en: "The LoRA audit is completed research.",
    vi: "Nghiên cứu kiểm toán LoRA đã hoàn thành.",
    evidence: [en.work.items[2].status, vi.work.items[2].status],
  }),
  fact({
    id: "lora.status.not_production",
    subject: "LoRA result",
    predicate: "does_not_establish_status",
    object: "production performance",
    polarity: "negative",
    planner: "The LoRA result does not establish production performance.",
    en: "The LoRA result does not establish production performance.",
    vi: "Kết quả LoRA chưa đủ để kết luận về hiệu năng trong môi trường vận hành.",
    evidence: [en.work.items[2].scope, vi.work.items[2].scope],
  }),
  fact({
    id: "lora.scope.not_open_world",
    subject: "LoRA result",
    predicate: "does_not_establish",
    object: "open-world performance",
    polarity: "negative",
    planner: "The LoRA result does not establish open-world performance; it is bounded to the stated model, task, and valid test set.",
    en: "The LoRA result does not establish open-world performance beyond the stated model, task, and valid test set.",
    vi: "Kết quả LoRA không chứng minh hiệu năng ngoài phạm vi mô hình, tác vụ và tập kiểm thử hợp lệ đã nêu.",
    evidence: [en.work.items[2].scope, vi.work.items[2].scope],
  }),
  fact({
    id: "site.interface.react_vite",
    subject: "public website",
    predicate: "uses_interface_stack",
    object: "React and Vite",
    planner: "The public website is built with React and Vite.",
    en: "The public website is built with React and Vite.",
    vi: "Website công khai được xây bằng React và Vite.",
    evidence: [en.chat.replies.build, vi.chat.replies.build],
  }),
  fact({
    id: "site.ask.one_question_no_chat_persistence",
    subject: "Ask Nhân",
    predicate: "processes_without_persistence",
    object: "one question at a time",
    qualifiers: { stores_chat_content: false },
    polarity: "negative",
    planner: "Ask Nhân processes one question at a time and does not persist questions, replies, or chat history.",
    en: "Ask Nhân processes one question at a time and does not persist questions, replies, or chat history.",
    vi: "Ask Nhân xử lý từng câu hỏi riêng lẻ và không lưu câu hỏi, câu trả lời hoặc lịch sử trò chuyện.",
    evidence: [en.chat.replies.ai, vi.chat.replies.ai],
  }),
  fact({
    id: "site.ask.predefined_fallback",
    subject: "public website",
    predicate: "returns_when_ai_unavailable",
    object: "predefined fallback answer",
    planner: "If the AI service is unavailable, the website returns a predefined fallback answer.",
    en: "If the AI service is unavailable, the website returns a predefined fallback answer.",
    vi: "Nếu dịch vụ AI không khả dụng, website trả về câu trả lời dự phòng đã định sẵn.",
    evidence: [en.chat.replies.ai, vi.chat.replies.ai],
  }),
  fact({
    id: "contact.public_section",
    subject: "public portfolio",
    predicate: "lists_contact_channels_in",
    object: "Contact section",
    planner: "Public contact channels are listed in the Contact section; the assistant should not repeat contact data.",
    en: "Public contact channels are listed in the Contact section.",
    vi: "Các kênh liên hệ công khai nằm trong mục Liên hệ.",
    evidence: [en.contact.body, en.contact.links, vi.contact.body, vi.contact.links],
  }),
]);

export const ASK_FACT_IDS = Object.freeze(ASK_FACTS.map(({ id }) => id));
const ASK_FACT_ID_SET = new Set(ASK_FACT_IDS);
const ASK_FACT_BY_ID = new Map(ASK_FACTS.map((item) => [item.id, item]));

const RELEVANCE_STOP_WORDS = new Set([
  "a", "about", "according", "an", "and", "answer", "are", "as", "at", "be", "by", "can", "could", "cua", "cho", "da", "did", "do", "does", "for", "from", "gi", "give", "has", "have", "hay", "he", "his", "how", "i", "in", "is", "it", "la", "me", "mot", "nhan", "nhu", "of", "on", "or", "please", "public", "said", "show", "tell", "that", "the", "thien", "this", "to", "toi", "tran", "va", "ve", "was", "were", "what", "when", "where", "which", "who", "why", "with", "would", "you",
]);

const RELEVANCE_REPLACEMENTS = Object.freeze([
  [/(?:retain|retains|retention|keep|keeps|store|stores|save|saves|persist|persistence)\s+(?:my\s+)?(?:messages?|chats?|conversations?|conversation\s+history|chat\s+history)/gu, " chat persistence "],
  [/(?:b\.?\s*eng\.?|bachelor of engineering)/gu, " bachelor degree "],
  [/(?:bang cach nao|bang cach)/gu, " how "],
  [/(?:chung nhan nghe nghiep|professional certification|professional certificate)/gu, " credential "],
  [/(?:save|saves|saving|savings|save up to|tiet kiem)\s+(?:annually|per year|a year|hang nam|moi nam)/gu, " cost "],
  [/(?:lora study|study (?:on|of) lora)/gu, " lora research "],
  [/(?:nghien cuu khoa hoc sinh vien|khoa hoc sinh vien)/gu, " student research "],
  [/(?:tell me everything about|full summary of|complete summary of)\s+(?:the\s+)?(call scoring|document ai|lora)(?:\s+(?:audit|project|system|study))?/gu, " $1 full summary "],
  [/(?:tell me about|summarize|summary of)\s+(?:his\s+|nhan s\s+)?projects?\b/gu, " project list "],
  [/(?:tell me about|summarize|summary of)\s+(?:his\s+|nhan s\s+)?education\b/gu, " education overview "],
  [/(?:tell me about|summarize|summary of)\s+(?:his\s+|nhan s\s+)?awards?\b/gu, " award list "],
  [/(?:tell me about|summarize|summary of)\s+(?:his\s+|nhan s\s+)?languages?\b/gu, " language list "],
  [/(?:what|which)\s+qualifications?\b|qualifications?\s+does\b/gu, " education overview "],
  [/(?:kind of work|type of work|loai cong viec)/gu, " profile role "],
  [/(?:xay bang|duoc xay bang|built with|build with)/gu, " technology "],
  [/(?:short bio|biography|\bbio\b|\bcv\b|resume|tom tat ho so)/gu, " profile biography "],
  [/(?:known for|noted for|thanh tich noi bat)/gu, " noteworthy award "],
  [/(?:recognition|recognitions|what awards|which awards|nhung giai thuong|giai thuong nao)/gu, " award list "],
  [/(?:what projects|which projects|nhung du an|du an nao)/gu, " project list "],
  [/(?:which languages|what languages|what are (?:nhan s|his|the candidate s) languages|cac ngon ngu|nhung ngon ngu)/gu, " language list "],
  [/(?:education background|education overview|hoc van)/gu, " education overview "],
  [/(?:worked on)/gu, " project list "],
  [/(?:selected work|portfolio work|working on|work on|lam du an)/gu, " project "],
  [/(?:previous employment|former employment|former employer|previous employer|formerly worked|worked previously|work for before|worked for before|tung lam|truoc day)/gu, " former employment "],
  [/(?:present workplace|current workplace|employer|nha tuyen dung hien tai|noi lam viec hien tai)/gu, " current employment "],
  [/(?:work for|works for|lam cho)/gu, " current employment for "],
  [/(?:working now|works now|work now)/gu, " current employment "],
  [/(?:currently works?|hien dang lam viec|dang lam viec)/gu, " current employment "],
  [/(?:hien dang lam|hien lam|dang lam o|dang lam|lam o dau)/gu, " current employment "],
  [/\b(?:employers?|employs?|employed|employment|working|worked|works?|workplace|lam viec|lam cho|cong tac|nha tuyen dung|tuyen dung)\b/gu, " employment "],
  [/(?:job title|position|vai tro|vi tri)/gu, " role "],
  [/(?:completed degree|degree did (?:he|nhan) complete|degree (?:he|nhan) completed|bang da hoan thanh)/gu, " completed bachelor degree "],
  [/\b(?:nganh y|y khoa)\b/gu, " study field medicine "],
  [/(?:undergraduate major|undergraduate|majored|major|field of study|hoc nganh|nganh hoc|chuyen nganh|nganh dai hoc|thuoc nganh)/gu, " bachelor study field "],
  [/(?:studying|studied|studies|pursuing|attended|educated|graduated|theo hoc|hoc tai|tot nghiep|\bhoc\b)/gu, " study "],
  [/(?:degrees?|bang cap|bang tien si|bang thac si|bang ky su|\bbang\b)/gu, " degree "],
  [/(?:certificates?|certifications?|certified|credentials?|chung chi)/gu, " credential "],
  [/(?:prizes?|awards?|giai thuong|giai nhi|dat giai|giai gi)/gu, " award "],
  [/(?:projects?|du an)/gu, " project "],
  [/(?:systems?|he thong)/gu, " system "],
  [/(?:built|builds?|created|creates?|developed|xay dung|\bxay\b|phat trien)/gu, " build "],
  [/(?:languages?|proficiency|trinh do|ngon ngu)/gu, " language "],
  [/(?:english|tieng anh)/gu, " english "],
  [/(?:vietnamese|tieng viet)/gu, " vietnamese "],
  [/(?:in production|production|\blive\b|van hanh|dua vao van hanh)/gu, " production "],
  [/(?:accuracy|do chinh xac)/gu, " accuracy "],
  [/(?:latency|do tre)/gu, " latency "],
  [/(?:cost savings?|cost reduction|tiet kiem chi phi|giam chi phi)/gu, " cost "],
  [/(?:research|nghien cuu)/gu, " research "],
  [/(?:framework|technologies|technology|tech stack|powered by|powers?|dung cong nghe)/gu, " technology "],
  [/(?:save chats?|save chat|store chats?|chat history|luu hoi thoai|luu chat)/gu, " chat persistence "],
  [/(?:emails?|e-mail|gui thu)/gu, " contact email "],
  [/(?:hien tai|den nay|present|currently|today)/gu, " current "],
  [/(?:quan ly)/gu, " manager "],
  [/(?:ky su)/gu, " engineer "],
  [/(?:lap trinh vien)/gu, " developer "],
  [/(?:chuyen vien)/gu, " specialist "],
  [/(?:thuc tap sinh)/gu, " intern "],
]);

const FACT_GROUP_ALIASES = Object.freeze([
  [/^profile\.role\./u, "profile biography background role profession occupation ai engineer ho so tieu su nghe nghiep ky su ai"],
  [/^profile\.location\./u, "profile location based city dia diem thanh pho"],
  [/^approach\./u, "profile approach principles workflow requirements business team overview cach lam nguyen tac quy trinh nghiep vu"],
  [/^employment\.kienlong\./u, "experience career current work role kienlongbank bank banking ai ngan hang kinh nghiem cong viec"],
  [/^employment\.mercedes\./u, "experience career work mercedes enterprise it internship intern cntt doanh nghiep thuc tap"],
  [/^education\.masters\./u, "education study degree master information system ptit cao hoc thac si hoc van"],
  [/^education\.beng\./u, "education study degree bachelor beng engineer information security ptit ky su an toan thong tin hoc van"],
  [/^credential\./u, "credential google coursera cybersecurity security an ninh mang"],
  [/^award\.student/u, "award student research phishing second 2023 sinh vien khoa hoc giai nhi"],
  [/^award\.scholarship/u, "award scholarship gpa academic excellence 2024 hoc bong xuat sac"],
  [/^language\.vietnamese/u, "language vietnamese native mother tongue ban ngu"],
  [/^language\.english/u, "language english upper intermediate can cao cap"],
  [/^call_scoring\./u, "project experience bank banking ai call scoring customer service speech llm cuoc goi cham diem cham soc khach hang ngan hang"],
  [/^document_ai\./u, "project document ai pdf multimodal extraction business pipeline tai lieu da phuong thuc trich xuat nghiep vu"],
  [/^lora\./u, "project experience security research lora backdoor audit adapter bao mat kiem toan"],
  [/^site\.interface\./u, "website site build stack react vite interface cong nghe"],
  [/^site\.ask\./u, "website site ask assistant chat privacy storage fallback tro ly quyen rieng tu luu"],
  [/^contact\./u, "contact reach email linkedin lien he"],
]);

const PROFILE_OVERVIEW_IDS = new Set([
  "profile.role.ai_engineer",
  "approach.end_to_end",
  "approach.reliability",
]);
const PROFILE_OVERVIEW_TOKENS = new Set([
  "background", "biography", "overview", "profile", "experience", "career", "ho", "so", "tieu", "su", "tong", "quan", "kinh", "nghiem",
]);

function idsWithPrefix(prefix) {
  return Object.freeze(ASK_FACT_IDS.filter((id) => id.startsWith(prefix)));
}

const PROJECT_OVERVIEW_IDS = Object.freeze([
  "call_scoring.workflow.traceable",
  "document_ai.pipeline.three_business_pdf",
  "lora.prototype.backdoor_screening",
]);
const EXPERIENCE_OVERVIEW_IDS = Object.freeze([
  "profile.role.ai_engineer",
  "employment.kienlong.current_role",
  "employment.mercedes.it_internship",
  ...PROJECT_OVERVIEW_IDS,
]);
const EMPLOYMENT_IDS = idsWithPrefix("employment.");
const EDUCATION_IDS = idsWithPrefix("education.");
const LANGUAGE_IDS = idsWithPrefix("language.");
const CALL_IDS = idsWithPrefix("call_scoring.");
const DOCUMENT_IDS = idsWithPrefix("document_ai.");
const LORA_IDS = idsWithPrefix("lora.");

const QUESTION_INTENT_RULES = Object.freeze([
  { name: "call_traceability", pattern: /\b(?:call scoring|call quality|customer service|speech llm|cuoc goi|cham diem)\b.{0,55}\b(?:trace|traceable|traceability|evidence|truy vet)\b|\b(?:trace|traceable|traceability|evidence|truy vet)\b.{0,55}\b(?:call scoring|call quality|customer service|speech llm|cuoc goi|cham diem)\b/u, ids: ["call_scoring.workflow.traceable"], exact: true, exclusive: true, suppress: ["call_scoring", "projects", "selected_work"] },
  { name: "approach_reliability", pattern: /\b(?:make|keep|ensure|maintain|improve|design|build|how|cach|dam bao)\b.{0,55}\b(?:reliable|reliability|reliably|robust|failure paths?|retries?|duplicates?|health checks?|do tin cay|tin cay)\b|\b(?:reliable|reliability|reliably|robust|do tin cay|tin cay)\b.{0,55}\b(?:make|keep|ensure|maintain|improve|design|build|how|cach|dam bao)\b/u, ids: ["approach.reliability"], exact: true, exclusive: true, suppress: ["approach", "ai_systems", "projects", "selected_work"] },
  { name: "credential_specific", pattern: /\b(?:credential|certification|certificate|chung nhan nghe nghiep|chung chi)\b/u, ids: ["credential.google_cybersecurity.mar_2024"], exact: true, exclusive: true, suppress: ["profile_role", "profile_intro"] },
  { name: "completed_beng", pattern: /\b(?:completed?|finished?|graduated?\s+(?:with|from)?|hoan thanh|tot nghiep)\b.{0,30}\b(?:bachelor|undergraduate|bachelor degree|b eng|beng|engineering degree)\b|\b(?:bachelor|undergraduate|bachelor degree|b eng|beng|engineering degree)\b.{0,30}\b(?:completed?|finished?|graduated?|hoan thanh|tot nghiep)\b/u, ids: ["education.beng.information_security.completed"], exact: true, exclusive: true, suppress: ["education", "beng", "masters"] },
  { name: "current_employment_qualified", pattern: /\b(?:current|present|currently|now)\b.{0,35}\b(?:role|position|job|work|employment)\b.{0,45}\b(?:kienlongbank|kien long|employer|company|bank)\b|\b(?:role|position|job|work|employment)\b.{0,35}\b(?:current|present|currently|now)\b.{0,45}\b(?:kienlongbank|kien long|employer|company|bank)\b|\b(?:role|position|job|work|employment)\b.{0,45}\b(?:kienlongbank|kien long)\b.{0,30}\b(?:current|present|currently|now)\b/u, ids: ["employment.kienlong.current_role"], exact: true, exclusive: true, suppress: ["employment", "current_employment", "kienlong", "experience", "education", "beng", "masters"] },
  { name: "document_status_bundle", pattern: /\bdocument ai\b.{0,35}\b(?:status|development)\b|\b(?:status|development)\b.{0,35}\bdocument ai\b|\bdevelopment\b.{0,20}\bproduction\b|\bproduction\b.{0,20}\bdevelopment\b/u, ids: ["document_ai.status.development", "document_ai.status.not_production"], requiredGroups: [["document_ai.status.development"], ["document_ai.status.not_production"]], exact: true, exclusive: true, suppress: ["document_ai", "document_production", "production"] },
  { name: "lora_qc_test_bundle", pattern: /\b(?:qc|quality control|kiem tra chat luong)\b.{0,60}\b(?:valid test|test lineages|test)\b|\b(?:valid test|test lineages|test)\b.{0,60}\b(?:qc|quality control|kiem tra chat luong)\b/u, ids: ["lora.experiment.qc_lineages_25", "lora.experiment.valid_test_lineages_8"], requiredGroups: [["lora.experiment.qc_lineages_25"], ["lora.experiment.valid_test_lineages_8"]], exact: true, exclusive: true, suppress: ["lora", "lora_qc", "lora_test", "projects", "selected_work"] },
  { name: "lora_prototype", pattern: /\b(?:lora|backdoor|adapter|security research|nghien cuu bao mat|kiem toan|audit)\b.{0,55}\b(?:prototype|screen|screening|build|adapter|backdoor)\b|\b(?:prototype|screen|screening|build|adapter|backdoor)\b.{0,55}\b(?:lora|security research|nghien cuu bao mat|kiem toan|audit)\b/u, ids: ["lora.prototype.backdoor_screening"], exact: true, exclusive: true, suppress: ["lora", "projects", "selected_work"] },
  { name: "site_retention", pattern: /\b(?:ask|assistant|chat|message|conversation|history)\b.{0,60}\b(?:retain|retention|keep|store|save|persist|persistence|storage|chat persistence)\b|\b(?:retain|retention|keep|store|save|persist|persistence|storage|chat persistence)\b.{0,60}\b(?:ask|assistant|chat|message|conversation|history)\b/u, ids: ["site.ask.one_question_no_chat_persistence"], exact: true, exclusive: true, suppress: ["site_general", "ask_general", "site_privacy"] },
  { name: "contact", pattern: /\b(?:contact|reach|get in touch|linkedin|lien he|lien lac)\b|\b(?:x|twitter)\s+(?:profile|account|handle)\b|\b(?:ho so|tai khoan)\s+x\b/u, ids: ["contact.public_section"] },
  { name: "profile_role", pattern: /\b(?:profession|occupation|profile role|ai engineer|nghe nghiep|ky su ai|job|do for work|do for a living|lam nghe)\b/u, ids: ["profile.role.ai_engineer"] },
  { name: "profile_intro", pattern: /\b(?:introduce|introduction|professional background|profile biography|gioi thieu)\b|\bwho is (?:nhan|he|the candidate)$|\b(?:nhan|anh ay|ong ay) la ai$/u, ids: ["profile.role.ai_engineer"] },
  { name: "profile_location", pattern: /\b(?:location|based|dia diem|thanh pho)\b/u, ids: ["profile.location.public_listing"] },
  { name: "approach", pattern: /\b(?:approach|principle|requirements|business team|cach lam|nguyen tac|nghiep vu)\b/u, ids: idsWithPrefix("approach.") },
  { name: "experience", pattern: /\b(?:experience|career|kinh nghiem|su nghiep)\b/u, ids: EXPERIENCE_OVERVIEW_IDS },
  { name: "current_employment", pattern: /\b(?:current employment|current role)\b|\bemployment\b.{0,24}\bcurrent\b|\bcurrent\b.{0,24}\bemployment\b/u, ids: ["employment.kienlong.current_role"] },
  { name: "former_employment", pattern: /\b(?:former employment|employment before|before kienlongbank)\b/u, ids: ["employment.mercedes.it_internship"] },
  { name: "employment", pattern: /\b(?:current employment|current role|former employment|employment)\b/u, ids: EMPLOYMENT_IDS },
  { name: "kienlong", pattern: /\b(?:kienlongbank|kien long)\b/u, ids: ["employment.kienlong.current_role"] },
  { name: "banking_ai", pattern: /\b(?:banking ai|ai ngan hang)\b/u, ids: ["call_scoring.workflow.traceable"] },
  { name: "mercedes", pattern: /\b(?:mercedes|enterprise it|cntt doanh nghiep|internship|intern|thuc tap)\b/u, ids: idsWithPrefix("employment.mercedes.") },
  { name: "education_overview", pattern: /\beducation overview\b/u, ids: EDUCATION_IDS, requiredGroups: EDUCATION_IDS.map((id) => [id]), exact: true },
  { name: "education", pattern: /\b(?:study|field|education|degree|ptit|university|college|school|institution|dai hoc|truong|qualifications?)\b/u, ids: EDUCATION_IDS },
  { name: "completed_beng", pattern: /\bcompleted bachelor degree\b/u, ids: ["education.beng.information_security.completed"] },
  { name: "masters", pattern: /\b(?:master|information system|thac si|cao hoc)\b/u, ids: ["education.masters.information_systems.current"] },
  { name: "beng", pattern: /\b(?:bachelor|beng|information security|an toan thong tin)\b/u, ids: ["education.beng.information_security.completed"] },
  { name: "credential", pattern: /\b(?:credential|cybersecurity|an ninh mang|coursera)\b/u, ids: ["credential.google_cybersecurity.mar_2024"] },
  { name: "student_award", pattern: /\b(?:student award|student research|phishing|giai nhi|khoa hoc sinh vien|award.{0,25}(?:sinh vien|research))\b/u, ids: ["award.student_research.second_2023"], exact: true },
  { name: "award_list", pattern: /\baward list\b/u, ids: ["award.student_research.second_2023", "award.scholarship.excellence_dec_2024"], requiredGroups: [["award.student_research.second_2023"], ["award.scholarship.excellence_dec_2024"]], exact: true },
  { name: "awards", pattern: /\baward\b/u, ids: ["award.student_research.second_2023", "award.scholarship.excellence_dec_2024"] },
  { name: "noteworthy", pattern: /\b(?:noteworthy|notable|dang chu y|noi bat)\b/u, ids: ["award.student_research.second_2023"] },
  { name: "scholarship", pattern: /\b(?:scholarship|gpa|academic excellence|hoc bong|xuat sac)\b/u, ids: ["award.scholarship.excellence_dec_2024"], exact: true },
  { name: "language_list", pattern: /\blanguage list\b/u, ids: LANGUAGE_IDS, requiredGroups: LANGUAGE_IDS.map((id) => [id]), exact: true },
  { name: "languages", pattern: /\b(?:language|bilingual|song ngu)\b/u, ids: LANGUAGE_IDS },
  { name: "english", pattern: /\benglish\b/u, ids: ["language.english.upper_intermediate"] },
  { name: "vietnamese", pattern: /\bvietnamese\b/u, ids: ["language.vietnamese.native"] },
  { name: "project_list", pattern: /\bproject list\b/u, ids: PROJECT_OVERVIEW_IDS, requiredGroups: PROJECT_OVERVIEW_IDS.map((id) => [id]), exact: true },
  { name: "projects", pattern: /\bproject\b/u, ids: PROJECT_OVERVIEW_IDS },
  { name: "selected_work", pattern: /\b(?:selected work|portfolio work|what.{0,20}build)\b/u, ids: PROJECT_OVERVIEW_IDS },
  { name: "ai_systems", pattern: /\b(?:ai system|system ai)\b/u, ids: ["call_scoring.workflow.traceable", "document_ai.pipeline.three_business_pdf"], requiredGroups: [["call_scoring.workflow.traceable"], ["document_ai.pipeline.three_business_pdf"]], exact: true },
  { name: "bank_work", pattern: /\bbuild\b.{0,35}\b(?:bank|banking|kienlongbank|ngan hang)\b|\b(?:bank|banking|kienlongbank|ngan hang)\b.{0,35}\bbuild\b/u, ids: ["call_scoring.workflow.traceable"] },
  { name: "production", pattern: /\b(?:production|shipped|launched|van hanh)\b/u, ids: ["call_scoring.status.production", "document_ai.status.development", "document_ai.status.not_production", "lora.status.research_completed", "lora.status.not_production"] },
  { name: "call_scoring", pattern: /\b(?:call scoring|call quality|customer service|speech llm|cuoc goi|cham diem)\b/u, ids: CALL_IDS },
  { name: "call_summary", pattern: /\bcall scoring full summary\b/u, ids: ["call_scoring.workflow.traceable", "call_scoring.status.production", "call_scoring.cost_reduction.estimated_180m_vnd_year", "call_scoring.metric.accuracy_not_published"], requiredGroups: [["call_scoring.workflow.traceable"], ["call_scoring.status.production"], ["call_scoring.cost_reduction.estimated_180m_vnd_year"], ["call_scoring.metric.accuracy_not_published"]], exact: true },
  { name: "call_accuracy", pattern: /\b(?:call scoring|call quality|cuoc goi|cham diem)\b.{0,50}\baccuracy\b|\baccuracy\b.{0,50}\b(?:call scoring|call quality|cuoc goi|cham diem)\b/u, ids: ["call_scoring.metric.accuracy_not_published"] },
  { name: "call_latency", pattern: /\b(?:call scoring|call quality|cuoc goi|cham diem)\b.{0,50}\blatency\b|\blatency\b.{0,50}\b(?:call scoring|call quality|cuoc goi|cham diem)\b/u, ids: ["call_scoring.metric.latency_not_published"] },
  { name: "call_uat", pattern: /\b(?:call scoring|call quality|cuoc goi|cham diem)\b.{0,50}\buat\b|\buat\b.{0,50}\b(?:call scoring|call quality|cuoc goi|cham diem)\b/u, ids: ["call_scoring.metric.uat_not_published"] },
  { name: "call_cost", pattern: /\b(?:call scoring|call quality|cuoc goi|cham diem)\b.{0,70}\b(?:cost|annual|annually|per year|save|saving|savings|hang nam|moi nam)\b|\b(?:cost|annual|annually|per year|save|saving|savings|hang nam|moi nam)\b.{0,70}\b(?:call scoring|call quality|cuoc goi|cham diem)\b/u, ids: ["call_scoring.cost_reduction.estimated_180m_vnd_year"], exact: true, exclusive: true, suppress: ["call_scoring", "call_summary"] },
  { name: "document_ai", pattern: /\b(?:document ai|business pdf|multimodal document|tai lieu da phuong thuc|pdf nghiep vu)\b/u, ids: DOCUMENT_IDS },
  { name: "document_summary", pattern: /\bdocument ai full summary\b/u, ids: ["document_ai.pipeline.three_business_pdf", "document_ai.request_modes.sync_async", "document_ai.status.not_production", "document_ai.metric.accuracy_not_published"], requiredGroups: [["document_ai.pipeline.three_business_pdf"], ["document_ai.request_modes.sync_async"], ["document_ai.status.not_production"], ["document_ai.metric.accuracy_not_published"]], exact: true },
  { name: "document_pipeline", pattern: /\bdocument ai\b.{0,50}\b(?:three|3|pipeline)\b|\b(?:three|3|pipeline)\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.pipeline.three_business_pdf"] },
  { name: "document_accuracy", pattern: /\bdocument ai\b.{0,50}\baccuracy\b|\baccuracy\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.metric.accuracy_not_published"] },
  { name: "document_latency", pattern: /\bdocument ai\b.{0,50}\blatency\b|\blatency\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.metric.latency_not_published"] },
  { name: "document_uat", pattern: /\bdocument ai\b.{0,50}\buat\b|\buat\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.metric.uat_not_published"] },
  { name: "document_cost", pattern: /\bdocument ai\b.{0,50}\bcost\b|\bcost\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.metric.cost_saving_not_published"] },
  { name: "document_production", pattern: /\bdocument ai\b.{0,50}\b(?:production|status|development)\b|\b(?:production|status|development)\b.{0,50}\bdocument ai\b/u, ids: ["document_ai.status.not_production"] },
  { name: "lora", pattern: /\b(?:lora|backdoor|adapter|kiem toan|security research|nghien cuu bao mat|research bao mat)\b/u, ids: LORA_IDS },
  { name: "lora_summary", pattern: /\blora full summary\b/u, ids: ["lora.prototype.backdoor_screening", "lora.metric.auroc_0_96875", "lora.metric.mcc_0_75", "lora.status.not_production"], requiredGroups: [["lora.prototype.backdoor_screening"], ["lora.metric.auroc_0_96875"], ["lora.metric.mcc_0_75"], ["lora.status.not_production"]], exact: true },
  { name: "lora_auroc", pattern: /\bauroc\b/u, ids: ["lora.metric.auroc_0_96875"] },
  { name: "lora_pr_auc", pattern: /\bpr auc\b/u, ids: ["lora.metric.pr_auc_0_975"] },
  { name: "lora_mcc", pattern: /\bmcc\b/u, ids: ["lora.metric.mcc_0_75"] },
  { name: "lora_pairs", pattern: /\b(?:model pairs|cap mo hinh)\b/u, ids: ["lora.experiment.pairs_36"] },
  { name: "lora_qc", pattern: /\b(?:quality control|kiem tra chat luong)\b/u, ids: ["lora.experiment.qc_lineages_25"] },
  { name: "lora_test", pattern: /\b(?:test lineages|valid test|nhom kiem thu|tap kiem thu)\b/u, ids: ["lora.experiment.valid_test_lineages_8"] },
  { name: "lora_test_bootstrap_confusion", pattern: /\b(?:(?:5000|5 000)\b.{0,30}\btest lineages|test lineages\b.{0,30}\b(?:5000|5 000))\b/u, ids: ["lora.experiment.valid_test_lineages_8", "lora.fusion.no_improvement_5000_bootstrap"], requiredGroups: [["lora.experiment.valid_test_lineages_8"], ["lora.fusion.no_improvement_5000_bootstrap"]] },
  { name: "lora_fusion", pattern: /\b(?:fusion|bootstrap)\b/u, ids: ["lora.fusion.no_improvement_5000_bootstrap"] },
  { name: "lora_open_world", pattern: /\bopen world\b/u, ids: ["lora.scope.not_open_world"] },
  { name: "lora_production", pattern: /\b(?:lora|audit)\b.{0,50}\bproduction\b|\bproduction\b.{0,50}\b(?:lora|audit)\b/u, ids: ["lora.status.not_production"] },
  { name: "site_interface", pattern: /\b(?:website|site|portfolio)\b.{0,50}\b(?:build|stack|react|vite|interface|technology)\b|\b(?:build|stack|react|vite|interface|technology)\b.{0,50}\b(?:website|site|portfolio)\b|\b(?:react|vite)\b/u, ids: ["site.interface.react_vite"] },
  { name: "site_general", pattern: /\b(?:website|site)\b.{0,35}\b(?:work|works|technology|cong nghe|hoat dong)\b/u, ids: ["site.interface.react_vite", "site.ask.one_question_no_chat_persistence", "site.ask.predefined_fallback"] },
  { name: "ask_general", pattern: /\bask\b.{0,30}\b(?:answer|capability|help|work|works|tra loi|hoat dong)\b/u, ids: ["site.ask.one_question_no_chat_persistence", "site.ask.predefined_fallback"] },
  { name: "site_privacy", pattern: /\b(?:ask|assistant|chat)\b.{0,50}\b(?:privacy|storage|persist|persistence|history|luu|quyen rieng tu)\b|\b(?:privacy|persist|persistence|quyen rieng tu)\b/u, ids: ["site.ask.one_question_no_chat_persistence"] },
  { name: "site_fallback", pattern: /\b(?:fallback|unavailable|du phong|khong kha dung)\b/u, ids: ["site.ask.predefined_fallback"] },
]);

const UNSUPPORTED_PREDICATE_PATTERN =
  /\b(?:lives|resides?|residence|nationality|promoted|promotion|leads?|leadership|principal architect|chief scientist)\b|\b(?:song tai|song o|quoc tich|thang chuc|lanh dao|truong phong)\b|\b(?:nhan|candidate|he)\s+(?:is|la)\s+vietnamese\b/u;
const UNSUPPORTED_ROLE_AT_ORGANIZATION_PATTERN =
  /\b(?:manager|engineer|developer|architect|scientist)\b.{0,35}\b(?:at|for|tai|o)\b/u;
const UNSUPPORTED_EARNED_MASTERS_PATTERN =
  /\b(?:earn(?:ed)?|complet(?:e|ed)|graduat(?:e|ed))\b.{0,35}\b(?:master|doctorate|doctoral|phd)\b|\b(?:master|doctorate|doctoral|phd)\b.{0,35}\b(?:earn(?:ed)?|complet(?:e|ed)|graduat(?:e|ed))\b|\b(?:tot nghiep|hoan thanh|da co bang)\b.{0,35}\b(?:thac si|tien si)\b/u;
const UNSUPPORTED_PRIVATE_DIRECTORY_PATTERN =
  /\b(?:private|internal|confidential|directory|database|records?)\b.{0,45}\b(?:employer|employment|contact|information|data|profile)\b|\b(?:employer|employment|contact|information|data|profile)\b.{0,45}\b(?:private|internal|confidential|directory|database|records?)\b/u;
const GREETING_ONLY_PATTERN =
  /^(?:hello|hi|hey|hello there|hi there|good morning|good afternoon|good evening|xin chao|chao|chao ban|cam on|thank you|thanks)[! .]*$/u;

const COUNTERPARTY_RULES = Object.freeze([
  { type: "employment", pattern: /\b(?:employment|role)\b.{0,45}?\b(?:at|for|cho|tai|o|la|is)\s+(.+?)(?=\b(?:and|va|before|after|truoc)\b|\||$)/gu, ids: EMPLOYMENT_IDS },
  { type: "employment", pattern: /\bcurrent employment\s+([a-z0-9][a-z0-9 ]{1,40})$/gu, ids: EMPLOYMENT_IDS },
  { type: "employment", pattern: /\b(?:is|la)\s+([a-z0-9][a-z0-9 ]{1,40}?)\s+(?:nhan s\s+)?current employment\b/gu, ids: EMPLOYMENT_IDS },
  { type: "employment", pattern: /\b([a-z0-9][a-z0-9 ]{1,30}?)\s+(?:is|la)\s+(?:nhan s\s+)?current employment\b/gu, ids: EMPLOYMENT_IDS },
  { type: "employment", pattern: /\b(?:is|la)\s+(.+?)\s+(?:nhan s\s+)?employment\b\s*(?=\||$)/gu, ids: EMPLOYMENT_IDS },
  { type: "employment", pattern: /(?:^|\|)\s*(.+?)\s+employment\s+(?:nhan|he)\b/gu, ids: EMPLOYMENT_IDS },
  { type: "education", pattern: /\b(?:study|degree)\b.{0,55}?\b(?:at|from|tai|tu|cua)\s+(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: EDUCATION_IDS },
  { type: "education_field", pattern: /\b(?:major|field|nganh)\b.{0,15}?\b(?:in|la)?\s*(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: EDUCATION_IDS },
  { type: "location", pattern: /\b(?:based|located|live|lives|reside|resides|dia diem|song)\b.{0,35}?\b(?:at|in|o|tai)\s+(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: ["profile.location.public_listing"] },
  { type: "credential", pattern: /\bcredential\b.{0,40}?\b(?:from|by|tu|cua)\s+(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: ["credential.google_cybersecurity.mar_2024"] },
  { type: "credential", pattern: /\b([a-z0-9][a-z0-9 ]{1,35}?)\s+credential\b/gu, ids: ["credential.google_cybersecurity.mar_2024"] },
  { type: "credential", pattern: /\bcredential\s+(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: ["credential.google_cybersecurity.mar_2024"] },
  { type: "award", pattern: /\b(?:win|wins|won|winning|receive|received|gianh|dat)\s+(?:an?\s+)?([a-z0-9]+(?:\s+[a-z0-9]+){0,2})\s+award\b/gu, ids: idsWithPrefix("award.") },
  { type: "award", pattern: /\b([a-z0-9]+(?:\s+[a-z0-9]+){0,2})\s+award\b/gu, ids: idsWithPrefix("award.") },
  { type: "project", pattern: /\bbuild\b.{0,50}?\b(?:for|cho)\s+(.+?)(?=\b(?:and|va)\b|\||$)/gu, ids: [...CALL_IDS, ...DOCUMENT_IDS, ...LORA_IDS] },
]);

const COUNTERPARTY_STOP_WORDS = new Set([
  "current", "former", "since", "from", "the", "a", "an", "now", "hien", "nay", "den", "thang", "nam", "role", "position", "work", "employment", "study", "pursuing", "holding", "according", "listed", "portfolio", "website", "at", "for", "cho", "tai", "tu", "cua", "by", "which", "does", "have", "has", "hold", "earn", "earned", "issued", "issuer", "received", "receive", "co", "nhung", "nao", "dau", "where", "what", "who", "is", "did", "in", "university", "school", "institution", "before", "after", "truoc", "field", "major", "award", "winning", "win", "known", "noteworthy", "notable", "khong", "phai", "s", "nhan", "he", "his", "do", "don", "vi", "cong", "ty", "company", "dai", "hoc", "anh", "ay", "gi", "ai", "cap", "gianh", "dat", "tung", "professional", "chuyen", "nghiep", "cybersecurity", "security", "an", "ninh", "mang", "certificate",
]);

function normalizeRelevanceText(value) {
  let normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/d\u0335|d\u0336|đ/gu, "d")
    .replace(/@?tran_thien_nhan\b/gu, " x contact handle ")
    .replace(/[^a-z0-9]+/gu, " ");
  for (const [pattern, replacement] of RELEVANCE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

function normalizeLiteralRelevanceText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/d\u0335|d\u0336|đ/gu, "d")
    .replace(/[^a-z0-9]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeCounterpartyText(value) {
  let normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/d\u0335|d\u0336|đ/gu, "d")
    .replace(/[.!?;]+/gu, " | ")
    .replace(/[^a-z0-9|]+/gu, " ");
  for (const [pattern, replacement] of RELEVANCE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

function relevanceTokens(value) {
  return new Set(
    normalizeRelevanceText(value)
      .split(" ")
      .filter((token) => token.length >= 2 && !RELEVANCE_STOP_WORDS.has(token)),
  );
}

function aliasesForFact(id) {
  return FACT_GROUP_ALIASES
    .filter(([pattern]) => pattern.test(id))
    .map(([, aliases]) => aliases)
    .join(" ");
}

const FACT_SEARCH_TOKEN_SETS = new Map(
  ASK_FACTS.map((item) => [
    item.id,
    relevanceTokens([
      item.id.replaceAll(".", " ").replaceAll("_", " "),
      item.planner,
      item.renderings.en,
      item.renderings.vi,
      aliasesForFact(item.id),
    ].join(" ")),
  ]),
);

function intersects(left, right) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function isProfileOverviewQuery(queryTokens) {
  if (queryTokens.size === 0) return true;
  return [...queryTokens].every((token) => PROFILE_OVERVIEW_TOKENS.has(token));
}

function normalizedNumber(value) {
  const raw = value.replace(/%$/u, "");
  const parts = raw.split(/[.,]/u);
  if (parts.length === 1) return parts[0].replace(/^0+(?=\d)/u, "") || "0";
  if (parts[0] !== "0" && parts.slice(1).every((part) => part.length === 3)) {
    return parts.join("").replace(/^0+(?=\d)/u, "");
  }
  return `${parts[0].replace(/^0+(?=\d)/u, "") || "0"}.${parts.slice(1).join("")}`;
}

function numberConstraints(value) {
  const matches = String(value ?? "").match(/\d+(?:[.,]\d+)*%?/gu) ?? [];
  const unique = new Map();
  for (const match of matches) {
    const constraint = { value: normalizedNumber(match), percent: match.endsWith("%") };
    unique.set(`${constraint.value}:${constraint.percent}`, constraint);
  }
  return [...unique.values()];
}

const FACT_NUMBER_CONSTRAINTS = new Map(
  ASK_FACTS.map((item) => [
    item.id,
    numberConstraints([
      item.planner,
      item.renderings.en,
      item.renderings.vi,
      JSON.stringify(item.assertion),
    ].join(" ")),
  ]),
);

function factHasNumber(id, constraint) {
  const fact = ASK_FACT_BY_ID.get(id);
  if (!fact) return false;
  if (constraint.percent) {
    const unit = String(fact.assertion.metric?.unit ?? "").toLowerCase();
    if (!/(?:percent|percentage|%)/u.test(unit)) return false;
  }
  return FACT_NUMBER_CONSTRAINTS.get(id)?.some(({ value }) => value === constraint.value) ?? false;
}

function constraintText(value) {
  let normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/đ/gu, "d")
    .replace(/[^a-z0-9.,% -]+/gu, " ");
  for (const [pattern, replacement] of RELEVANCE_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

const METRIC_NAMES = Object.freeze([
  { token: "auroc", pattern: /\bauroc\b/u },
  { token: "pr auc", pattern: /\bpr[ -]?auc\b/u },
  { token: "mcc", pattern: /\bmcc\b/u },
  { token: "accuracy", pattern: /\baccuracy\b/u },
  { token: "latency", pattern: /\blatency\b/u },
  { token: "uat", pattern: /\buat\b/u },
  { token: "gpa", pattern: /\bgpa\b/u },
]);

function metricNumberRequirements(value, allowedIds) {
  const normalized = constraintText(value);
  const requirements = [];
  const consumedNumbers = new Set();
  const numberPattern = "(\\d+(?:[.,]\\d+)*%?)";
  for (const { token, pattern } of METRIC_NAMES) {
    if (!pattern.test(normalized)) continue;
    const escaped = token.replace(" ", "[ -]?");
    const pairPattern = new RegExp(
      `(?:\\b${escaped}\\b[^\\n]{0,24}?${numberPattern}|${numberPattern}[^\\n]{0,24}?\\b${escaped}\\b)`,
      "gu",
    );
    for (const match of normalized.matchAll(pairPattern)) {
      const number = match[1] ?? match[2];
      const constraint = { value: normalizedNumber(number), percent: number.endsWith("%") };
      consumedNumbers.add(`${constraint.value}:${constraint.percent}`);
      const ids = new Set(
        [...allowedIds].filter((id) => {
          const tokens = FACT_SEARCH_TOKEN_SETS.get(id);
          return token.split(" ").every((part) => tokens?.has(part));
        }),
      );
      requirements.push(ids);
    }
  }
  return { requirements, consumedNumbers };
}

function counterpartyRequirements(normalized, allowedIds) {
  const requirements = [];
  for (const rule of COUNTERPARTY_RULES) {
    // A phrase may contain several domain words (for example "study at" in
    // a current-employer question).  Only run a counterparty extractor when
    // that extractor can constrain at least one currently eligible fact;
    // otherwise an unrelated empty requirement would turn a valid plan into
    // a false abstention.
    if (!rule.ids.some((id) => allowedIds.has(id))) continue;
    for (const match of normalized.matchAll(rule.pattern)) {
      if (rule.type === "employment" && /^(?:before|after|truoc)\b/u.test(match[1].trim())) {
        continue;
      }
      const tokens = relevanceTokens(match[1]);
      for (const token of COUNTERPARTY_STOP_WORDS) tokens.delete(token);
      for (const token of [...tokens]) {
        if (/^\d/u.test(token)) tokens.delete(token);
      }
      if (tokens.size === 0) continue;
      if (rule.type === "project" && tokens.has("kienlongbank")) {
        tokens.delete("kienlongbank");
        tokens.add("bank");
      }
      const ids = new Set(
        rule.ids.filter((id) => {
          if (!allowedIds.has(id)) return false;
          const factTokens = FACT_SEARCH_TOKEN_SETS.get(id);
          return factTokens && [...tokens].every((token) => factTokens.has(token));
        }),
      );
      requirements.push(ids);
    }
  }
  return requirements;
}

const BROAD_INTENT_NAMES = new Set([
  "experience",
  "awards",
  "employment",
  "education",
  "languages",
  "projects",
  "production",
  "call_scoring",
  "document_ai",
  "lora",
  "site_general",
]);

const EXCLUSIVE_INTENT_NAMES = new Set([
  "call_traceability",
  "approach_reliability",
  "credential_specific",
  "completed_beng",
  "current_employment_qualified",
  "document_status_bundle",
  "lora_qc_test_bundle",
  "lora_prototype",
  "site_retention",
]);

function effectiveIntentRules(normalized, queryTokens) {
  const matched = QUESTION_INTENT_RULES.filter(({ pattern }) => pattern.test(normalized));
  if (matched.length === 0 && isProfileOverviewQuery(queryTokens)) {
    return [{ name: "profile_overview", ids: [...PROFILE_OVERVIEW_IDS] }];
  }
  const exclusiveMatched = matched.filter(({ name }) => EXCLUSIVE_INTENT_NAMES.has(name));
  if (exclusiveMatched.length > 0) {
    const exclusiveNames = new Set(exclusiveMatched.map(({ name }) => name));
    const suppressNames = new Set(exclusiveMatched.flatMap(({ suppress = [] }) => suppress));
    const exclusiveIds = new Set(exclusiveMatched.flatMap(({ ids }) => ids));
    return matched.filter((candidate) => {
      if (exclusiveNames.has(candidate.name)) return true;
      if (suppressNames.has(candidate.name)) return false;
      if (
        BROAD_INTENT_NAMES.has(candidate.name) &&
        matched.some((other) =>
          other !== candidate &&
          !BROAD_INTENT_NAMES.has(other.name) &&
          other.ids.some((id) => candidate.ids.includes(id))
        )
      ) return false;
      // A broad rule which shares an exclusive fact cannot widen the closed
      // answer set.  Unrelated, explicitly matched rules (for example a
      // credential + award sentence) are retained for multi-topic questions.
      return !candidate.ids.some((id) => exclusiveIds.has(id));
    });
  }
  return matched.filter((candidate) => {
    if (
      candidate.name === "kienlong" &&
      matched.some(({ name }) =>
        name === "former_employment" ||
        name === "bank_work" ||
        name === "ai_systems" ||
        name === "projects" ||
        name === "selected_work"
      )
    ) return false;
    if (
      candidate.name === "projects" &&
      matched.some(({ name }) =>
        name === "call_scoring" ||
        name === "document_ai" ||
        name === "lora" ||
        name.startsWith("call_") ||
        name.startsWith("document_") ||
        name.startsWith("lora_")
      )
    ) return false;
    if (!BROAD_INTENT_NAMES.has(candidate.name)) return true;
    const candidateIds = new Set(candidate.ids);
    return !matched.some((other) =>
      other !== candidate &&
      !BROAD_INTENT_NAMES.has(other.name) &&
      other.ids.some((id) => candidateIds.has(id))
    );
  });
}

const QUESTION_CLASSIFICATIONS = Object.freeze({
  SUPPORTED_SINGLETON: "supported_singleton",
  DEFINITELY_UNSUPPORTED: "definitely_unsupported",
  AMBIGUOUS: "ambiguous",
});
const PORTFOLIO_CONTEXT_PATTERN =
  /\b(?:nhan|he|his|candidate|portfolio|website|site|ask|anh ay|ong ay)\b/u;
const EXTERNAL_TOPIC_PATTERN =
  /\b(?:weather|forecast|temperature|stock price|exchange rate|sports score|lottery|thoi tiet|nhiet do|ty gia|gia co phieu|xo so)\b/u;

function fallbackFactIds(queryTokens, normalized = "") {
  // Never infer an answer from a loose token overlap when the question names
  // a relationship/counterparty.  Those queries require a domain intent and
  // the closed counterparty validator; otherwise "build ... for Google" can
  // accidentally look like a portfolio-system question.
  if (/\b(?:at|for|from|to|with|cho|tai|tu|cua)\b/u.test(normalized)) return [];
  const meaningful = new Set(
    [...queryTokens].filter((token) => token.length >= 3 && !RELEVANCE_STOP_WORDS.has(token)),
  );
  if (meaningful.size === 0) return [];
  const scored = ASK_FACTS.map(({ id }) => {
    const factTokens = FACT_SEARCH_TOKEN_SETS.get(id) ?? new Set();
    const overlap = [...meaningful].filter((token) => factTokens.has(token));
    return { id, score: overlap.length, overlap };
  }).filter(({ score }) => score > 0);
  if (scored.length === 0) return [];
  const maxScore = Math.max(...scored.map(({ score }) => score));
  // A one-token match is useful only when it is unique; otherwise a generic
  // term such as "experience" would admit an arbitrary same-domain bundle.
  const top = scored.filter(({ score }) => score === maxScore);
  if (maxScore === 1 && top.length > 1) return [];
  return top.slice(0, MAX_SELECTED_FACTS).map(({ id }) => id);
}

function analyzeQuestion(message) {
  const normalized = normalizeRelevanceText(message);
  const literalNormalized = normalizeLiteralRelevanceText(message);
  const queryTokens = relevanceTokens(message);
  const greetingOnly = isAskGreetingOnly(message);
  const hardUnsupported =
    UNSUPPORTED_PREDICATE_PATTERN.test(literalNormalized) ||
    UNSUPPORTED_ROLE_AT_ORGANIZATION_PATTERN.test(literalNormalized) ||
    UNSUPPORTED_EARNED_MASTERS_PATTERN.test(literalNormalized) ||
    UNSUPPORTED_PRIVATE_DIRECTORY_PATTERN.test(literalNormalized);
  const intentRules = greetingOnly ? [] : effectiveIntentRules(normalized, queryTokens);
  const allowedIds = new Set(intentRules.flatMap(({ ids }) => ids));
  const requirements = intentRules.flatMap(({ ids, requiredGroups }) =>
    (requiredGroups ?? [ids]).map((group) => new Set(group))
  );
  const exactRules = intentRules.filter(({ exact }) => exact);
  const expectedIds = exactRules.length > 0
    ? new Set(exactRules.flatMap(({ ids }) => ids))
    : null;

  requirements.push(...counterpartyRequirements(normalizeCounterpartyText(message), allowedIds));
  const metricRequirements = metricNumberRequirements(message, allowedIds);
  for (const constraint of numberConstraints(message)) {
    if (metricRequirements.consumedNumbers.has(`${constraint.value}:${constraint.percent}`)) continue;
    requirements.push(new Set([...allowedIds].filter((id) => factHasNumber(id, constraint))));
  }
  requirements.push(...metricRequirements.requirements);

  const constraintMismatch = requirements.some((ids) => ids.size === 0);
  if (greetingOnly) {
    return {
      classification: QUESTION_CLASSIFICATIONS.AMBIGUOUS,
      eligibleIds: new Set(),
      greetingOnly,
      knownSupport: false,
      requirements: [],
      expectedIds: null,
    };
  }
  if (hardUnsupported || constraintMismatch) {
    return {
      classification: QUESTION_CLASSIFICATIONS.DEFINITELY_UNSUPPORTED,
      eligibleIds: new Set(),
      greetingOnly,
      knownSupport: false,
      requirements,
      expectedIds,
    };
  }
  if (allowedIds.size > 0) {
    const eligibleIds = new Set(
      [...allowedIds].filter((id) => requirements.some((ids) => ids.has(id))),
    );
    return {
      classification: eligibleIds.size === 1
        ? QUESTION_CLASSIFICATIONS.SUPPORTED_SINGLETON
        : QUESTION_CLASSIFICATIONS.AMBIGUOUS,
      eligibleIds,
      greetingOnly,
      knownSupport: true,
      requirements,
      expectedIds,
    };
  }

  if (/\b(?:at|for|from|to|with|cho|tai|tu|cua)\b/u.test(normalized)) {
    // No intent matched a relationship-bearing question.  Treat the
    // counterparty as unsupported instead of sending a loose portfolio query
    // to the planner, which would otherwise spend a model call on a known
    // false-premise shape.
    return {
      classification: QUESTION_CLASSIFICATIONS.DEFINITELY_UNSUPPORTED,
      eligibleIds: new Set(),
      greetingOnly,
      knownSupport: false,
      requirements: [],
      expectedIds: null,
    };
  }

  const inPortfolioScope = PORTFOLIO_CONTEXT_PATTERN.test(normalized) &&
    !EXTERNAL_TOPIC_PATTERN.test(normalized);
  if (!inPortfolioScope) {
    return {
      classification: QUESTION_CLASSIFICATIONS.DEFINITELY_UNSUPPORTED,
      eligibleIds: new Set(),
      greetingOnly,
      knownSupport: false,
      requirements: [],
    };
  }
  const fallbackIds = fallbackFactIds(queryTokens, normalized);
  if (fallbackIds.length === 0) {
    return {
      classification: QUESTION_CLASSIFICATIONS.AMBIGUOUS,
      eligibleIds: new Set(),
      greetingOnly,
      knownSupport: false,
      requirements: [],
      expectedIds: null,
    };
  }
  const eligibleIds = new Set(fallbackIds);
  return {
    classification: QUESTION_CLASSIFICATIONS.AMBIGUOUS,
    eligibleIds,
    greetingOnly,
    knownSupport: true,
    requirements: eligibleIds.size > 0 ? [eligibleIds] : [],
    expectedIds: new Set(eligibleIds),
  };
}

export function isAskGreetingOnly(message) {
  return GREETING_ONLY_PATTERN.test(normalizeRelevanceText(message));
}

export function eligibleFactIdsForQuestion(message) {
  const analysis = analyzeQuestion(message);
  return Object.freeze([...analysis.eligibleIds]);
}

export function classifyAskQuestion(message) {
  const analysis = analyzeQuestion(message);
  return Object.freeze({
    kind: analysis.classification,
    factIds: Object.freeze([...analysis.eligibleIds]),
  });
}

export function askPlanMatchesQuestion(plan, message) {
  const analysis = analyzeQuestion(message);
  if (plan.mode === "greeting") return analysis.greetingOnly;
  if (plan.mode === "not_available") {
    return !analysis.greetingOnly && (
      analysis.classification === QUESTION_CLASSIFICATIONS.DEFINITELY_UNSUPPORTED ||
      (analysis.classification === QUESTION_CLASSIFICATIONS.AMBIGUOUS && !analysis.knownSupport)
    );
  }
  if (
    analysis.greetingOnly ||
    analysis.classification === QUESTION_CLASSIFICATIONS.DEFINITELY_UNSUPPORTED
  ) return false;
  const selected = new Set(plan.fact_ids);
  if (analysis.expectedIds) {
    if (selected.size !== analysis.expectedIds.size) return false;
    for (const id of analysis.expectedIds) {
      if (!selected.has(id)) return false;
    }
  }
  return (
    plan.fact_ids.every((id) => analysis.eligibleIds.has(id)) &&
    analysis.requirements.every((ids) => intersects(selected, ids))
  );
}

export const ASK_FACT_CATALOG = ASK_FACTS
  .map(({ id, planner }) => `${id}: ${planner}`)
  .join("\n");

export const ASK_PLAN_MODES = Object.freeze(["facts", "not_available", "greeting"]);
export const ASK_QUESTION_CLASSIFICATIONS = QUESTION_CLASSIFICATIONS;

const MODE_RENDERINGS = deepFreeze({
  greeting: {
    en: "Hello. Ask about Nhân’s public experience, projects, education, credentials, languages, or this website.",
    vi: "Xin chào. Bạn có thể hỏi về kinh nghiệm, dự án, học vấn, chứng chỉ, ngôn ngữ hoặc website công khai của Nhân.",
  },
  not_available: {
    en: "That information is not available in Nhân’s public portfolio. Ask about his public experience, projects, education, credentials, languages, or how this website works.",
    vi: "Thông tin đó không có trong hồ sơ công khai của Nhân. Bạn có thể hỏi về kinh nghiệm, dự án, học vấn, chứng chỉ, ngôn ngữ hoặc cách website hoạt động.",
  },
});

export function renderAskPlan(plan, locale) {
  if (plan.mode === "facts") {
    return plan.fact_ids
      .map((id) => ASK_FACT_BY_ID.get(id)?.renderings[locale])
      .join(" ");
  }
  return MODE_RENDERINGS[plan.mode]?.[locale] ?? "";
}

export function isAskFactId(value) {
  return typeof value === "string" && ASK_FACT_ID_SET.has(value);
}

export { MAX_SELECTED_FACTS };
