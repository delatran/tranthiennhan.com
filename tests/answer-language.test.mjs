import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_LANGUAGE_PROFILE,
  answerMatchesLocale,
  resolveAnswerLocale,
} from "../src/answer-language.js";

const confidentEnglish = [
  "What has Nhân shipped to production?",
  "Where does Nhân work?",
  "How does the website protect privacy?",
  "Which credentials does Nhân have?",
  "Why is the Document AI project useful?",
  "Summarize Nhân's current role and experience.",
  "What did Nhân build with React and Vite?",
  "Can you explain the latest OpenAI Responses API update?",
];

const confidentVietnamese = [
  "Nhân đã đưa hệ thống nào vào vận hành?",
  "Nhân đang làm việc ở đâu?",
  "Website bảo vệ quyền riêng tư như thế nào?",
  "Nhân có những chứng chỉ nào?",
  "Tóm tắt vai trò và kinh nghiệm hiện tại của Nhân.",
  "Nhan da lam gi voi Document AI?",
  "OpenAI co gi moi tren X?",
  "Website bao ve du lieu nhu the nao?",
];

test("freezes the answer-language profile", () => {
  assert.equal(ANSWER_LANGUAGE_PROFILE, "en-vi");
});

for (const [index, question] of confidentEnglish.entries()) {
  test(`routes confident English ${index + 1} independently of page locale`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "en");
    assert.equal(resolveAnswerLocale(question, "vi"), "en");
  });
}

for (const [index, question] of confidentVietnamese.entries()) {
  test(`routes confident Vietnamese ${index + 1} independently of page locale`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "vi");
    assert.equal(resolveAnswerLocale(question, "vi"), "vi");
  });
}

for (const question of [
  "Nhân",
  "LoRA",
  "GPT-5.6 Luna",
  "https://x.com/openai/status/1234567890",
  "OpenAI?",
  "const x = 1;",
]) {
  test(`falls back for neutral or ambiguous input: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "en");
    assert.equal(resolveAnswerLocale(question, "vi"), "vi");
  });
}

for (const question of [
  "Where là đâu?",
  "Why tại sao?",
  "What là gì?",
  "Current vai trò?",
]) {
  test(`falls back for balanced mixed input: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "en");
    assert.equal(resolveAnswerLocale(question, "vi"), "vi");
  });
}

test("does not let the Vietnamese proper name Nhân override English", () => {
  assert.equal(resolveAnswerLocale("What did Nhân build?", "vi"), "en");
});

test("does not mistake an uppercase AI acronym for Vietnamese 'ai'", () => {
  const passage =
    "AI ImpactTM highlights how leaders are combining human judgment with machine speed—improving productivity, reducing errors, and unlocking new capabilities across teams.";
  assert.equal(resolveAnswerLocale(passage, "en"), "en");
  assert.equal(resolveAnswerLocale(passage, "vi"), "en");
  assert.equal(answerMatchesLocale(passage, "en"), true);
  assert.equal(answerMatchesLocale(passage, "vi"), false);
});

test("detects short but meaningful questions", () => {
  assert.equal(resolveAnswerLocale("Why now?", "vi"), "en");
  assert.equal(resolveAnswerLocale("Sao vậy?", "en"), "vi");
  assert.equal(resolveAnswerLocale("Hello!", "vi"), "en");
  assert.equal(resolveAnswerLocale("Sao?", "en"), "vi");
});

const unaccentedVietnameseFrames = [
  "nam nay",
  "chi phi",
  "xem lai",
  "cau hinh",
  "ngu canh",
  "goi y",
  "sua loi",
  "thang truoc",
  "doc lai",
];

for (const question of unaccentedVietnameseFrames) {
  test(`routes bounded unaccented Vietnamese frame independently: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "vi");
    assert.equal(resolveAnswerLocale(question, "vi"), "vi");
  });
}

for (const identifier of ["Phi", "Gap", "y"]) {
  test(`keeps an ambiguous standalone compound token on page fallback: ${identifier}`, () => {
    assert.equal(resolveAnswerLocale(identifier, "en"), "en");
    assert.equal(resolveAnswerLocale(identifier, "vi"), "vi");
  });
}

test("validates confident generated prose and tolerates neutral identifiers", () => {
  assert.equal(
    answerMatchesLocale(
      "Nhân built a production Document AI system with OpenAI Responses API.",
      "en",
    ),
    true,
  );
  assert.equal(
    answerMatchesLocale(
      "Nhân xây dựng hệ thống Document AI cho môi trường vận hành.",
      "vi",
    ),
    true,
  );
});

test("rejects confidently opposite-language generated prose", () => {
  const english =
    "Nhân builds reliable AI systems and explains the production evidence clearly.";
  const vietnamese =
    "Nhân xây dựng hệ thống AI tin cậy và giải thích bằng chứng vận hành rõ ràng.";
  assert.equal(answerMatchesLocale(english, "vi"), false);
  assert.equal(answerMatchesLocale(vietnamese, "en"), false);
});

test("does not fabricate confidence for identifier-only output", () => {
  assert.equal(answerMatchesLocale("GPT-5.6 Luna.", "en"), true);
  assert.equal(answerMatchesLocale("GPT-5.6 Luna.", "vi"), true);
});

test("rejects short unambiguous opposite-language answers", () => {
  assert.equal(answerMatchesLocale("No.", "vi"), false);
  assert.equal(answerMatchesLocale("Không.", "en"), false);
  assert.equal(answerMatchesLocale("Yes.", "en"), true);
  assert.equal(answerMatchesLocale("Có.", "vi"), true);
});

const heldOutLanguageQueries = [
  ["vi", "Neu ba diem manh cua ung vien."],
  ["vi", "Dau la bang chung cho nhan dinh do?"],
  ["vi", "Mo ta ho so cua Nhan."],
  ["vi", "Ai la Nhan?"],
  ["vi", "Tra loi ngan gon."],
  ["vi", "Cho them thong tin."],
  ["en", "Describe Nhân’s strongest project."],
  ["en", "Review Nhân’s portfolio."],
  ["en", "List Nhân’s technical strengths."],
  ["en", "The user wrote “Nhân đã làm gì?”; translate that sentence."],
  ["vi", "Người dùng viết “What did Nhân build?”; hãy dịch câu đó."],
  ["en", "Explain the phrase “kinh nghiệm làm việc” in English."],
  ["vi", "Hãy explain dự án hiện tại của Nhân."],
  ["en", "Correct."],
  ["en", "Review."],
  ["en", "Career?"],
  ["vi", "Đúng."],
  ["vi", "Sai."],
  ["vi", "Hồ sơ?"],
  ["en", "Projects?"],
  ["en", "Current role?"],
  ["vi", "Du an?"],
  ["vi", "Kinh nghiem?"],
  ["vi", "Lien he?"],
  ["vi", "Vai tro?"],
];

for (const [expectedLocale, question] of heldOutLanguageQueries) {
  test(`routes held-out ${expectedLocale} query independently: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), expectedLocale);
    assert.equal(resolveAnswerLocale(question, "vi"), expectedLocale);
  });
}

test("joins Unicode format-control fragments before language detection", () => {
  for (const value of ["Wh\u200Bat?", "Wha\u200Bt?", "Cor\u200Brect."]) {
    assert.equal(resolveAnswerLocale(value, "vi"), "en");
  }
  for (const value of ["Khô\u200Bng?", "Tạ\u200Bi sao?"]) {
    assert.equal(resolveAnswerLocale(value, "en"), "vi");
  }
});

const independentTechnicalQueries = [
  ["en", "Please investigate GLM caching."],
  ["en", "Analyze GLM caching performance."],
  ["en", "Nemotron benchmarks?"],
  ["en", "OpenRouter latency?"],
  ["en", "Assess provider compatibility."],
  ["en", "Examine source attribution."],
  ["en", "Investigate model routing behavior."],
  ["en", "Check response quality."],
  ["vi", "Kiem tra bo nho dem."],
  ["vi", "Danh gia toc do phan hoi."],
  ["vi", "Phan tich kha nang tuong thich."],
  ["vi", "Khao sat chat luong trich dan."],
  ["vi", "Do luong hieu nang truy xuat."],
];

for (const [expectedLocale, question] of independentTechnicalQueries) {
  test(`routes independent technical ${expectedLocale} query: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), expectedLocale);
    assert.equal(resolveAnswerLocale(question, "vi"), expectedLocale);
  });
}

for (const question of [
  "Please mô tả the current project.",
  "Can you tóm tắt his experience?",
  "What bằng chứng supports this claim?",
  "Please trả lời in English.",
  "What does <code>vai tro</code> mean?",
]) {
  test(`uses the English outer request frame: ${question}`, () => {
    assert.equal(resolveAnswerLocale(question, "en"), "en");
    assert.equal(resolveAnswerLocale(question, "vi"), "en");
  });
}

const englishOutputs = [
  "Correct.",
  "Done.",
  "Not available.",
  "He said “Nhân đã hoàn thành dự án” but provided no evidence.",
  "This means “đã triển khai” in Vietnamese.",
  "It depends.",
  "Probably.",
  "Nothing found.",
  "I cannot verify that claim.",
  "Please ask a more specific question.",
  "See https://tranthiennhan.com/xnhan for details.",
  "Ｃｏｒｒｅｃｔ.",
  'The code `const ngonNgu = "vi"` stores a string.',
  "English.",
  "Three projects.",
  "He built three systems.",
  "Cloudflare hosts it.",
  "The returned X posts discuss the topic.",
  "The cited X record discusses OpenRouter caching.",
  "OpenRouter caching reduces repeated input costs.",
  "OAuth latency regression.",
  "Latency regression after deploy.",
  "The API request finished successfully.",
  "Cloudflare Workers handled the request successfully.",
  "Production-ready.",
  "It failed.",
  "The model returned JSON.",
  "<code>response_format</code> controls structured output.",
  "Unverified.",
  "Unsupported.",
  "Completed.",
  "Succeeded.",
  "Failed.",
  "Relevant.",
  "Insufficient.",
  "Unavailable.",
  "Verified.",
  "Concise.",
  "Thanks.",
];

const vietnameseOutputs = [
  "Đúng.",
  "Sai.",
  "Xong.",
  "Chưa rõ.",
  "Tùy trường hợp.",
  "Có lẽ.",
  "Tôi chưa thể xác minh nhận định đó.",
  "Đúｎｇ.",
  "Câu\u200F trả lời này ngắn gọn.",
  "Cụm tiếng Anh “answer briefly” có nghĩa là “trả lời ngắn gọn”.",
  "Tiếng Việt.",
  "Hai du an.",
  "Ba du an.",
  "Nhan lam o ngan hang.",
  "Nó thất bại.",
  "Chuẩn.",
  "Tốt.",
  "Rõ.",
  "Tệ.",
  "Hỏng.",
  "Ổn.",
  "Sai lệch.",
  "Bất ổn.",
  "Cam on.",
  "Xin chao.",
  "Hen gap lai.",
  "Rat tot.",
  "Hoan thanh.",
];

for (const value of englishOutputs) {
  test(`accepts only English for held-out output: ${value}`, () => {
    assert.equal(answerMatchesLocale(value, "en"), true);
    assert.equal(answerMatchesLocale(value, "vi"), false);
  });
}

for (const value of vietnameseOutputs) {
  test(`accepts only Vietnamese for held-out output: ${value}`, () => {
    assert.equal(answerMatchesLocale(value, "vi"), true);
    assert.equal(answerMatchesLocale(value, "en"), false);
  });
}

test("rejects a confident opposite-language clause even when other prose dominates", () => {
  const englishThenVietnamese =
    "This answer is direct, complete, and clearly supported by evidence. Nhân xây dựng hệ thống AI cho ngân hàng.";
  const vietnameseThenEnglish =
    "Câu trả lời này trực tiếp, đầy đủ và có bằng chứng rõ ràng. Nhân builds reliable AI systems for banking.";
  assert.equal(answerMatchesLocale(englishThenVietnamese, "en"), false);
  assert.equal(answerMatchesLocale(vietnameseThenEnglish, "vi"), false);
});

test("rejects opposite-language paragraphs and conjunction-delimited clauses", () => {
  assert.equal(
    answerMatchesLocale(
      "This answer is supported by current evidence.\n\nNhân đã hoàn thành dự án.",
      "en",
    ),
    false,
  );
  assert.equal(
    answerMatchesLocale(
      "Câu trả lời có bằng chứng rõ ràng nhưng Nhân built the production system.",
      "vi",
    ),
    false,
  );
});

test("keeps quoted and code spans neutral during per-segment validation", () => {
  assert.equal(
    answerMatchesLocale(
      "The user wrote “Nhân xây dựng hệ thống AI cho ngân hàng.” This English answer only explains that quoted text.",
      "en",
    ),
    true,
  );
  assert.equal(
    answerMatchesLocale(
      "Câu trả lời tiếng Việt giải thích đoạn mã <code>return 'English answer';</code> một cách rõ ràng.",
      "vi",
    ),
    true,
  );
});

test("allows only allowlisted neutral output artifacts and name fragments", () => {
  for (const value of [
    "GPT-5.6 Luna.",
    "OpenAI.",
    "Nhân.",
    "https://tranthiennhan.com/xnhan",
    "<code>const x = 1;</code>",
  ]) {
    assert.equal(answerMatchesLocale(value, "en"), true);
    assert.equal(answerMatchesLocale(value, "vi"), true);
  }

  for (const value of ["Secret Salary Ledger", "Alice Bob Carol"]) {
    assert.equal(answerMatchesLocale(value, "en"), false);
    assert.equal(answerMatchesLocale(value, "vi"), false);
  }
});
