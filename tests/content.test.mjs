import assert from "node:assert/strict";
import test from "node:test";
import { content, locales } from "../src/content.js";

function flattenShape(value, prefix = "") {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenShape(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenShape(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

test("English and Vietnamese resources have the same shape", () => {
  assert.deepEqual(flattenShape(content.en), flattenShape(content.vi));
});

test("footer AI credit stays playful without presenting a model ranking as fact", () => {
  assert.match(content.en.footer.credit, /GPT 5\.6 Sol/u);
  assert.match(content.en.footer.credit, /Claude Opus 5 and Claude Fable 5 may be rated more highly/u);
  assert.match(content.en.footer.credit, /taste and judgment of the person using it/u);
  assert.match(content.vi.footer.credit, /GPT 5\.6 Sol/u);
  assert.match(content.vi.footer.credit, /Claude Opus 5 và Claude Fable 5 có thể được đánh giá cao hơn/u);
  assert.match(content.vi.footer.credit, /gu thẩm mỹ và cách người dùng khai thác công cụ/u);
  assert.doesNotMatch(
    `${content.en.footer.credit}\n${content.vi.footer.credit}`,
    /[-‐‑‒–—―]|GPT[^.]{0,80}(?:is|là) (?:weaker|worse|yếu hơn)|outperform/iu,
  );
});

test("public contact options include the owner X profile after LinkedIn", () => {
  for (const locale of locales) {
    assert.deepEqual(content[locale].contact.links.at(-1), {
      label: locale === "vi" ? "Xem hồ sơ X" : "View X profile",
      value: "@tran_thien_nhan",
      href: "https://x.com/tran_thien_nhan",
    });
  }
});

test("all localized leaves are non-empty strings", () => {
  locales.forEach((locale) => {
    const visit = (value, path = "") => {
      if (Array.isArray(value)) {
        return value.forEach((item, index) => visit(item, `${path}[${index}]`));
      }
      if (value && typeof value === "object") {
        return Object.entries(value).forEach(([key, child]) =>
          visit(child, path ? `${path}.${key}` : key),
        );
      }
      assert.equal(typeof value, "string");
      assert.ok(value.trim().length > 0);
    };
    visit(content[locale]);
  });
});

test("Ask Nhân remains confined to the chat experience in both locales", () => {
  locales.forEach((locale) => {
    const { chat, ...pageContent } = content[locale];

    assert.equal(chat.title, "Ask Nhân");
    assert.equal("work" in pageContent, true);
    assert.equal("work" in pageContent.nav, true);
    assert.equal("product" in pageContent, true);
    assert.equal(pageContent.nav.product, "X Nhân");
    assert.equal("projects" in pageContent.nav, false);
    assert.doesNotMatch(JSON.stringify(pageContent), /Ask Nhân/u);
  });
});

test("X Nhân is presented as a separate personal product with an honest source boundary", () => {
  for (const locale of locales) {
    const product = content[locale].product;
    assert.equal(product.name, "X Nhân");
    assert.equal(product.flow.length, 3);
    assert.equal(product.proofs.length, 3);
    assert.match(product.independence, /X Corp\./u);
  }

  assert.match(content.vi.product.body, /thích X.+tin tức.+công nghệ/iu);
  assert.match(content.vi.product.body, /nội dung gốc tồn tại/iu);
  assert.match(content.en.product.body, /like X.+technology news/iu);
  assert.match(content.en.product.body, /original posts live/iu);
  assert.match(content.vi.product.proofs[1].text, /không được tự điền/iu);
  assert.match(content.en.product.proofs[1].text, /not invented/iu);
  assert.equal(content.en.product.badge, "New");
  assert.equal(content.vi.product.badge, "Mới");
  assert.equal(content.en.nav.product, "X Nhân");
  assert.equal(content.vi.nav.product, "X Nhân");
  assert.equal(content.en.work.items.length, 3);
  assert.equal(content.vi.work.items.length, 3);
});

test("Ask Nhân describes its no-storage boundary consistently in both locales", () => {
  locales.forEach((locale) => {
    const chat = content[locale].chat;

    assert.equal("analytics" in chat, false);
    assert.ok(chat.newChat.length > 0);
    assert.ok(chat.copyAnswer.length > 0);
    assert.ok(chat.retry.length > 0);
    assert.ok(chat.viewSection.includes("{section}"));
    assert.equal("verification" in chat, false);
    assert.equal("verification" in chat.status, false);
    assert.doesNotMatch(
      JSON.stringify(chat),
      /redacted|retention|analytics copy|30 days|30 ngày|che dữ liệu|bản đã lưu/iu,
    );
  });

  assert.doesNotMatch(content.en.chat.disclosure, /browser is checked|security check/iu);
  assert.match(content.en.chat.disclosure, /does not save questions, replies, or chat history/u);
  assert.match(content.en.chat.disclosure, /conversation disappears when you reload/u);
  assert.match(
    content.en.chat.disclosure,
    /Visit and page-performance analytics never receive chat text/u,
  );
  assert.match(content.en.chat.disclosure, /AI can be wrong/u);
  assert.doesNotMatch(
    content.vi.chat.disclosure,
    /Trình duyệt được kiểm tra|kiểm tra bảo mật/iu,
  );
  assert.match(content.vi.chat.disclosure, /không lưu câu hỏi, câu trả lời hay lịch sử trò chuyện/u);
  assert.match(content.vi.chat.disclosure, /nội dung sẽ mất khi tải lại/u);
  assert.match(
    content.vi.chat.disclosure,
    /Thống kê lượt truy cập và hiệu năng trang không nhận nội dung trò chuyện/u,
  );
  assert.match(content.vi.chat.disclosure, /AI có thể trả lời sai/u);
  assert.match(content.en.footer.privacy, /limited technical visit data/iu);
  assert.match(content.en.footer.privacy, /Chat text is never included/u);
  assert.match(content.vi.footer.privacy, /một số dữ liệu kỹ thuật về lượt truy cập/iu);
  assert.match(content.vi.footer.privacy, /Nội dung trò chuyện không bao giờ được đưa vào/u);
  assert.doesNotMatch(
    JSON.stringify(content),
    /\bCloudflare\b|\bTurnstile\b|Workers\s+AI|@cf\//iu,
  );
});

test("the public profile is grounded in the approved general AI Engineer resume", () => {
  const serialized = JSON.stringify(content);

  assert.doesNotMatch(serialized, /\bACB\b/u);
  assert.equal(content.en.hero.role, "AI Engineer · Applied AI systems");
  assert.equal(content.vi.hero.role, "Kỹ sư AI · Hệ thống AI ứng dụng");
  assert.equal(content.en.experience.roles[0].organization, "KienlongBank");
  assert.match(content.en.experience.roles[0].organizationDetail, /Kien Long/u);
  assert.match(content.vi.experience.roles[0].role, /Nghiên cứu và Phát triển/u);
  assert.match(content.en.work.items[0].outcome, /VND 180 million/u);
  assert.equal(content.en.work.items[1].metrics[0].value, "3");
  assert.equal(content.en.work.items[2].metrics[0].value, "0.96875");
  assert.equal(content.en.work.items[2].metrics[1].value, "0.975");
  assert.equal(content.en.work.items[2].metrics[2].value, "0.75");
  assert.equal(content.en.experience.languages[1].level, "Upper-intermediate");
  assert.equal(content.vi.experience.languages[1].level, "Cận cao cấp");
});

test("organization identities are explicit, deduplicated, and locale-safe", () => {
  locales.forEach((locale) => {
    const experience = content[locale].experience;

    assert.deepEqual(
      experience.roles.map((role) => role.organizationKey),
      ["kienlongbank", "mercedesBenz"],
    );
    assert.equal(experience.education.length, 2);
    assert.ok(experience.educationInstitution.length > 0);
    assert.ok(experience.educationCampus.length > 0);
    assert.ok(experience.education.every((item) => !("school" in item)));
  });

  assert.equal(
    content.en.experience.educationInstitution,
    "Posts and Telecommunications Institute of Technology",
  );
  assert.equal(
    content.vi.experience.educationInstitution,
    "Học viện Công nghệ Bưu chính Viễn thông",
  );
});

test("project status and scope remain explicit without overstating results", () => {
  const statuses = content.en.work.items.map((item) => item.status);
  const slugs = content.en.work.items.map((item) => item.slug);

  assert.deepEqual(statuses, [
    "In production",
    "In development",
    "Research completed",
  ]);
  assert.deepEqual(slugs, ["call-scoring", "document-ai", "lora-audit"]);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(content.en.work.labels.index, "Project index");
  assert.equal(content.vi.work.labels.index, "Danh mục dự án");
  assert.equal(content.en.work.labels.period, "Project period");
  assert.equal(content.vi.work.labels.period, "Thời gian thực hiện");
  assert.match(content.en.work.items[0].scope, /accuracy, latency, or UAT/u);
  assert.match(content.en.work.items[1].scope, /still in development/u);
  assert.match(content.en.work.items[1].scope, /do not describe it as production/u);
  assert.match(content.en.work.items[2].scope, /production or open-world performance/u);
  assert.match(content.vi.work.items[0].scope, /độ chính xác, độ trễ hoặc UAT/u);
  assert.match(content.vi.work.items[1].scope, /chưa được đưa vào vận hành/u);
  assert.match(content.vi.work.items[2].scope, /chưa đủ để kết luận về môi trường vận hành/u);
});

test("LoRA quality-control units are not collapsed into an unsupported ratio", () => {
  assert.match(content.en.work.items[2].outcome, /36 clean\/backdoored pairs/u);
  assert.match(content.en.work.items[2].outcome, /Twenty-five lineages passed quality control/u);
  assert.equal(content.en.work.items[2].metrics[3].value, "25");
  assert.doesNotMatch(
    JSON.stringify(content.en.work.items[2]),
    /25\s*\/\s*36[^.]{0,40}lineages/iu,
  );
});

test("the retired manifesto and translationese phrases cannot return", () => {
  const serialized = JSON.stringify(content);
  const retiredPhrases = [
    /AI that survives contact with reality/iu,
    /Built inside real operating constraints/iu,
    /Three systems\. Three evidence states/iu,
    /Let[’']s talk about AI that has to work/iu,
    /Evidence-led AI/iu,
    /AI đứng vững khi gặp thực tế/iu,
    /Xây dựng trong ràng buộc vận hành thật/iu,
    /Ba hệ thống\. Ba trạng thái bằng chứng/iu,
    /Hãy trao đổi về AI cần phải hoạt động thật/iu,
    /AI dựa trên bằng chứng/iu,
    /Định hình quyết định/iu,
    /Thiết kế bằng chứng/iu,
    /Làm chủ vận hành/iu,
    /giao nhận AI ứng dụng/iu,
    /phản hồi tất định minh bạch/iu,
    /limits of what can be concluded/iu,
    /phạm vi có thể kết luận/iu,
    /integrate the result into the team[’']s working process/iu,
    /Portfolio Kỹ sư AI/iu,
    /Những phần tôi trực tiếp phụ trách/iu,
    /cơ chế sửa trong giới hạn/iu,
    /callback có xác thực/iu,
  ];

  retiredPhrases.forEach((phrase) => assert.doesNotMatch(serialized, phrase));
});
