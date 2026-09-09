export const SECURITIES_SOURCE_POLICY = Object.freeze({
  version: "public-issuer-sources-v1",
  maxBytes: 20 * 1024 * 1024,
  maxHtmlBytes: 2 * 1024 * 1024,
  timeoutMs: 25_000,
  maxRedirects: 3,
  maxAttempts: 2,
  freshnessTtlMs: 24 * 60 * 60 * 1000,
  originalRetention: "local-private-research",
  fullTextRedistribution: false,
});

export const SECURITIES_ISSUERS = Object.freeze([
  {
    id: "FPT",
    ticker: "FPT",
    name: "FPT Corporation",
    legalName: "Công ty Cổ phần FPT",
    exchange: "HOSE",
    aliases: ["fpt"],
    sector: { vi: "Công nghệ · Viễn thông · Giáo dục", en: "Technology · Telecom · Education" },
    landingUrl: "https://fpt.com/vi/nha-dau-tu/thong-tin-cong-bo",
    copyright: "©2015 Copyright by FPT Corp.",
  },
  {
    id: "GMD",
    ticker: "GMD",
    name: "Gemadept Corporation",
    legalName: "Công ty Cổ phần Tập đoàn Gemadept",
    exchange: "HOSE",
    aliases: ["gmd", "gemadept"],
    sectorId: "ports_logistics",
    sector: { vi: "Khai thác cảng · Logistics", en: "Ports · Logistics" },
    landingUrl: "https://www.gemadept.com.vn/co-dong/bao-cao-tai-chinh/",
    copyright: "Copyright © 2024 Gemadept. All Rights Reserved.",
  },
  {
    id: "VSC",
    ticker: "VSC",
    name: "Vietnam Container Shipping Corporation",
    legalName: "Công ty Cổ phần Container Việt Nam",
    exchange: "HOSE",
    aliases: ["vsc", "viconship", "container viet nam"],
    sectorId: "ports_logistics",
    sector: { vi: "Khai thác cảng · Logistics", en: "Ports · Logistics" },
    landingUrl: "https://viconship.com/co-dong",
    copyright: "Copyright 2025 © Công ty Cổ phần Container Việt Nam",
  },
  {
    id: "ACB",
    ticker: "ACB",
    name: "Asia Commercial Joint Stock Bank",
    legalName: "Ngân hàng Thương mại Cổ phần Á Châu",
    exchange: "HOSE",
    aliases: ["acb", "ngan hang a chau", "a chau"],
    sectorId: "banking",
    sector: { vi: "Ngân hàng", en: "Banking" },
    landingUrl: "https://acb.com.vn/vi/nha-dau-tu/bao-cao-tai-chinh-2026",
    copyright: "Ngân hàng Thương mại Cổ phần Á Châu (ACB)",
  },
]);

const fptRights = {
  status: "personal_noncommercial_with_attribution",
  termsUrl: "https://fpt.com/vi/dieu-khoan-su-dung",
  checkedAt: "2026-09-06T11:03:00.000Z",
  attribution: "©2015 Copyright by FPT Corp.",
  localOriginalAllowed: true,
  fullTextRedistribution: false,
  note: "Issuer terms permit personal, noncommercial viewing, downloading and extraction with attribution. Commercial redistribution is not granted.",
};
const gmdRights = {
  status: "public_download_no_redistribution_grant",
  termsUrl: "https://www.gemadept.com.vn/gmd-bctc-soat-xet-ban-nien-2026/",
  checkedAt: "2026-09-06T11:03:00.000Z",
  attribution: "Copyright © 2024 Gemadept. All Rights Reserved.",
  localOriginalAllowed: true,
  fullTextRedistribution: false,
  note: "Public issuer attachment retained for this private local analysis. The page reserves copyright; no full-text republication or commercial reuse license was identified.",
};
const vscRights = {
  status: "public_download_no_redistribution_grant",
  termsUrl: "https://viconship.com/co-dong",
  checkedAt: "2026-09-08T02:21:30.557Z",
  attribution: "Copyright 2025 © Công ty Cổ phần Container Việt Nam",
  localOriginalAllowed: true,
  fullTextRedistribution: false,
  note: "Official shareholder page links the public attachment and reserves copyright. Retained for private local analysis; no full-text republication or commercial reuse license was identified.",
};
const acbRights = {
  status: "public_download_no_redistribution_grant",
  termsUrl: "https://acb.com.vn/vi/nha-dau-tu/bao-cao-tai-chinh-2026",
  checkedAt: "2026-09-08T09:55:59.885Z",
  attribution: "Ngân hàng Thương mại Cổ phần Á Châu (ACB)",
  localOriginalAllowed: true,
  fullTextRedistribution: false,
  note: "Official investor disclosure links the searchable reference copy and the signed consolidated interim statements. Retained for private local analysis; no full-text republication license is asserted.",
};

export const SECURITIES_SOURCE_DOCUMENTS = Object.freeze([
  {
    id: "fpt-h1-2026",
    companyId: "FPT",
    periodId: "H1_2026",
    title: "FPT · Báo cáo tài chính hợp nhất bán niên đã soát xét 2026",
    url: "https://fpt.com/api/media/20260821_FPT_BCTC_hop_nhat_ban_nien_da_soat_xet_nam_2026_3b1ebb3536.pdf",
    landingUrl: "https://fpt.com/vi/nha-dau-tu/thong-tin-cong-bo",
    publishedAt: "2026-08-21",
    publicationDateBasis: "issuer_disclosure_page",
    signedAt: "2026-08-17",
    fetchedAt: "2026-09-06T11:03:36.273Z",
    hash: "45636554f28c7e6c2f38458b9a22410ed1f67e80627d672b827019a67f299df8",
    bytes: 9260382,
    pageCount: 66,
    sourceType: "scan_pdf",
    auditStatus: "reviewed",
    scope: "consolidated",
    unit: "VND",
    reportType: "interim_financial_statements",
    rights: fptRights,
    statementPages: [18],
    contextualPages: [6, 7, 12, 18],
    printedPageOffset: -4,
  },
  {
    id: "fpt-annual-2025",
    companyId: "FPT",
    periodId: "FY2025",
    title: "FPT · Báo cáo thường niên 2025, phần báo cáo tài chính hợp nhất",
    url: "https://bctn2025.fpt.com/wp-content/uploads/2026/04/BCTN-2025.pdf",
    landingUrl: "https://bctn2025.fpt.com/",
    publishedAt: "2026-04-08",
    publicationDateBasis: "issuer_disclosure_page",
    signedAt: "2026-03-18",
    auditorReportDate: "2026-03-19",
    fetchedAt: "2026-09-06T11:03:38.648Z",
    hash: "9449a7251d126b635988974dbc72c2773c7fff39f4e5e858b5f7d3928b4e0e6c",
    bytes: 12345876,
    pageCount: 232,
    sourceType: "text_pdf",
    auditStatus: "audited",
    scope: "consolidated",
    unit: "VND",
    reportType: "annual_report_financial_statements",
    rights: fptRights,
    statementPages: [169, 170],
    contextualPages: [164, 175, 209, 210, 212, 213],
    printedPageOffset: -1,
  },
  {
    id: "gmd-h1-2026",
    companyId: "GMD",
    periodId: "H1_2026",
    title: "GMD · Báo cáo tài chính hợp nhất soát xét bán niên 2026",
    url: "https://www.gemadept.com.vn/wp-content/uploads/2026/08/20260829-GMD-BCTC-Hop-nhat-soat-xet-ban-nien-2026.pdf",
    landingUrl: "https://www.gemadept.com.vn/gmd-bctc-soat-xet-ban-nien-2026/",
    publishedAt: "2026-08-29",
    publicationDateBasis: "issuer_disclosure_page",
    signedAt: "2026-08-28",
    fetchedAt: "2026-09-06T11:03:35.142Z",
    hash: "2d4c5cd550d18ec9c84a67b4d74d2f51b883c24f9398fc08df458891ec5ec4d1",
    bytes: 13350256,
    pageCount: 63,
    sourceType: "scan_pdf",
    auditStatus: "reviewed",
    scope: "consolidated",
    unit: "VND",
    reportType: "interim_financial_statements",
    rights: gmdRights,
    statementPages: [11, 12],
    contextualPages: [6, 47, 48, 49, 50],
    printedPageOffset: -1,
  },
  {
    id: "vsc-h1-2026",
    companyId: "VSC",
    periodId: "H1_2026",
    title: "VSC · Báo cáo tài chính hợp nhất bán niên đã soát xét 2026",
    url: "https://viconship.com/wp-content/uploads/2026/08/20260828-VSC-Bao-cao-tai-chinh-hop-nhat-ban-nien-30.06.2026.pdf",
    landingUrl: "https://viconship.com/co-dong",
    publishedAt: "2026-08-28",
    publicationDateBasis: "issuer_disclosure_letter",
    signedAt: "2026-08-28",
    fetchedAt: "2026-09-08T02:21:30.557Z",
    hash: "6ead1d852b12f468da71dc3e1ea830549124e99ec073078008051a540402862d",
    bytes: 3224116,
    pageCount: 59,
    sourceType: "scan_pdf",
    auditStatus: "reviewed",
    scope: "consolidated",
    unit: "VND",
    reportType: "interim_financial_statements",
    rights: vscRights,
    statementPages: [12, 13],
    contextualPages: [1, 3, 7, 8, 9],
    printedPageOffset: -4,
  },
  {
    id: "acb-h1-2026",
    companyId: "ACB",
    periodId: "H1_2026",
    title: "ACB · Báo cáo tài chính hợp nhất bán niên đã soát xét 2026 · Bản tra cứu",
    url: "https://acb.com.vn/acbwebsite/files/ACB%20BCTC%20hop%20nhat%20ban%20nien%202026_ban%20tra%20cuu.pdf",
    landingUrl: "https://acb.com.vn/vi/nha-dau-tu/bao-cao-tai-chinh-2026",
    publishedAt: "2026-08-14",
    publicationDateBasis: "issuer_disclosure_page",
    signedAt: "2026-08-12",
    fetchedAt: "2026-09-08T09:55:59.885Z",
    hash: "639ecab36c0d6444e80db53bd9043552bcfcfa2df9a7b52be35fdae18fbe6701",
    bytes: 1196225,
    pageCount: 95,
    sourceType: "text_pdf",
    auditStatus: "reviewed",
    scope: "consolidated",
    unit: "VND_million",
    reportType: "interim_financial_statements",
    rights: acbRights,
    statementPages: [10, 11],
    contextualPages: [1, 2, 5, 6, 12, 13, 14],
    printedPageOffset: -2,
    reviewedCompanion: {
      url: "https://acb.com.vn/acbwebsite/files/20260814%20-%20ACB%20-%20BCTC%20hop%20nhat%20ban%20nien%202026.pdf",
      hash: "41402e2875f75a1dd614f15add810c1424098bf3c87184f7bb09eb03e7a61498",
      role: "signed_original_cross_check",
    },
  },
]);

export const SECURITIES_METRICS = Object.freeze({
  revenue: {
    label: { vi: "Doanh thu thuần", en: "Net revenue" },
    definition: {
      vi: "Doanh thu bán hàng và cung cấp dịch vụ sau các khoản giảm trừ; chỉ tiêu 10.",
      en: "Revenue from goods and services after deductions; statement line 10.",
    },
  },
  gross_profit: {
    label: { vi: "Lợi nhuận gộp", en: "Gross profit" },
    definition: {
      vi: "Doanh thu thuần trừ giá vốn hàng bán; chỉ tiêu 20.",
      en: "Net revenue less cost of sales; statement line 20.",
    },
  },
  profit_before_tax: {
    label: { vi: "Lợi nhuận trước thuế", en: "Profit before tax" },
    definition: {
      vi: "Tổng lợi nhuận kế toán trước thuế thu nhập doanh nghiệp.",
      en: "Total accounting profit before corporate income tax.",
    },
  },
  profit_after_tax: {
    label: { vi: "Lợi nhuận sau thuế", en: "Profit after tax" },
    definition: {
      vi: "Lợi nhuận sau thuế toàn tập đoàn, gồm phần cổ đông không kiểm soát nếu có.",
      en: "Consolidated profit after tax, including any non-controlling interests.",
    },
  },
  profit_parent: {
    label: { vi: "LNST thuộc cổ đông công ty mẹ", en: "Profit attributable to parent" },
    definition: {
      vi: "Lợi nhuận sau thuế phân bổ cho cổ đông công ty mẹ.",
      en: "Profit after tax attributable to shareholders of the parent.",
    },
  },
  financial_income: {
    label: { vi: "Doanh thu tài chính", en: "Financial income" },
    definition: {
      vi: "Doanh thu hoạt động tài chính theo báo cáo, có thể bao gồm khoản không thường xuyên.",
      en: "Reported financial income, which can include non-recurring items.",
    },
  },
  operating_profit: {
    label: { vi: "Lợi nhuận thuần từ HĐKD", en: "Operating result" },
    definition: {
      vi: "Lợi nhuận thuần từ hoạt động kinh doanh theo BCTC Việt Nam, bao gồm thu nhập tài chính và lãi liên doanh liên kết; chỉ tiêu 30.",
      en: "Vietnamese statement line 30, including financial income and associates. This is not EBIT.",
    },
  },
  operating_cash_flow: {
    label: {
      vi: "Dòng tiền thuần từ hoạt động kinh doanh",
      en: "Net cash from operating activities",
    },
    definition: {
      vi: "Lưu chuyển tiền thuần từ hoạt động kinh doanh trong báo cáo lưu chuyển tiền tệ hợp nhất; chỉ tiêu 20.",
      en: "Net cash from operating activities in the consolidated cash-flow statement; line 20.",
    },
    statement: "cash_flow",
  },
  net_interest_income: {
    label: { vi: "Thu nhập lãi thuần", en: "Net interest income" },
    definition: {
      vi: "Thu nhập lãi và các khoản thu nhập tương tự trừ chi phí lãi và các chi phí tương tự của ngân hàng.",
      en: "Bank interest and similar income less interest and similar expenses.",
    },
  },
  net_fee_income: {
    label: { vi: "Lãi thuần từ hoạt động dịch vụ", en: "Net fee and commission income" },
    definition: {
      vi: "Thu nhập từ hoạt động dịch vụ trừ chi phí hoạt động dịch vụ của ngân hàng.",
      en: "Bank fee and commission income less related service expenses.",
    },
  },
  operating_expenses: {
    label: { vi: "Chi phí hoạt động", en: "Operating expenses" },
    definition: {
      vi: "Chi phí hoạt động ngân hàng, giữ nguyên dấu âm của báo cáo gốc.",
      en: "Bank operating expenses, retaining the negative sign reported in the original statement.",
    },
  },
  operating_profit_before_provision: {
    label: {
      vi: "Lợi nhuận hoạt động trước dự phòng tín dụng",
      en: "Operating profit before credit provisions",
    },
    definition: {
      vi: "Lợi nhuận thuần từ hoạt động kinh doanh ngân hàng trước chi phí dự phòng rủi ro tín dụng, sau chi phí hoạt động.",
      en: "Bank operating profit after operating expenses and before credit risk provision expense.",
    },
  },
  credit_loss_provision: {
    label: { vi: "Chi phí dự phòng rủi ro tín dụng", en: "Credit risk provision expense" },
    definition: {
      vi: "Chi phí dự phòng rủi ro tín dụng trong kỳ, giữ nguyên dấu của báo cáo gốc; không phải số dư dự phòng trên bảng tình hình tài chính.",
      en: "Credit risk provision expense for the period, retaining its reported sign. This is not the balance sheet allowance balance.",
    },
  },
  bank_operating_cash_flow: {
    label: {
      vi: "Dòng tiền thuần từ hoạt động kinh doanh ngân hàng",
      en: "Net cash from banking operating activities",
    },
    definition: {
      vi: "Dòng tiền kinh doanh ngân hàng gồm biến động cho vay, tiền gửi và các tài sản, công nợ hoạt động. Không dùng làm tỷ lệ chuyển đổi lợi nhuận thành tiền của doanh nghiệp thông thường.",
      en: "Bank operating cash flow includes changes in loans, deposits, and other operating assets and liabilities. It is not a commercial-company earnings cash conversion measure.",
    },
    statement: "cash_flow",
  },
});

export const SECURITIES_EXTRACTION_RULES = Object.freeze({
  "fpt-annual-2025": [
    { id: "revenue", rowCode: "10", page: 169, match: "Doanh thu thuần" },
    { id: "gross_profit", rowCode: "20", page: 169, match: "Lợi nhuận gộp" },
    {
      id: "profit_before_tax",
      rowCode: "50",
      page: 169,
      match: "Tổng lợi nhuận kế toán trước thuế",
    },
    { id: "profit_after_tax", rowCode: "60", page: 170, match: "Lợi nhuận sau thuế TNDN" },
    { id: "profit_parent", rowCode: "61", page: 170, match: "Cổ đông của công ty mẹ" },
  ],
  "fpt-h1-2026": [
    {
      id: "revenue",
      rowCode: "10",
      page: 18,
      match: "Doanh thu thuần",
      valueCount: 4,
      comparisonIndex: 2,
    },
    {
      id: "profit_before_tax",
      rowCode: "50",
      page: 18,
      match: "Tổng lợi nhuận kế toán trước thuế",
      valueCount: 4,
      comparisonIndex: 2,
    },
    {
      id: "profit_after_tax",
      rowCode: "60",
      page: 18,
      match: "Lợi nhuận sau thuế thu nhập doanh nghiệp",
      valueCount: 4,
      comparisonIndex: 2,
    },
    {
      id: "profit_parent",
      rowCode: "61",
      page: 18,
      match: "Lợi nhuận sau thuế của Cổ đông Công ty mẹ",
      valueCount: 4,
      comparisonIndex: 2,
    },
  ],
  "gmd-h1-2026": [
    { id: "revenue", rowCode: "10", page: 11, match: "Doanh thu thuần" },
    { id: "gross_profit", rowCode: "20", page: 11, match: "Lợi nhuận gộp" },
    { id: "profit_before_tax", rowCode: "50", page: 11, match: "Tổng lợi nhuận kế toán trước thu" },
    {
      id: "profit_after_tax",
      rowCode: "60",
      page: 11,
      match: "Lợi nhuận sau thuế thu nhập doanh nghiệp",
    },
    { id: "profit_parent", rowCode: "61", page: 11, match: "Lợi nhuận sau thuế của công ty mẹ" },
    { id: "financial_income", rowCode: "22", page: 11, match: "Doanh thu hoạt động tài chính" },
    {
      id: "operating_profit",
      rowCode: "30",
      page: 11,
      match: "Lợi nhuận thuần từ hoạt động kinh doanh",
    },
    {
      id: "operating_cash_flow",
      rowCode: "20",
      page: 12,
      match: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
    },
  ],
  "vsc-h1-2026": [
    { id: "revenue", rowCode: "10", page: 12, match: "Doanh thu thuần" },
    { id: "gross_profit", rowCode: "20", page: 12, match: "Lợi nhuận gộp" },
    {
      id: "profit_before_tax",
      rowCode: "50",
      page: 12,
      match: "Tổng lợi nhuận kế toán trước thuế",
    },
    {
      id: "profit_after_tax",
      rowCode: "60",
      page: 12,
      match: "Lợi nhuận sau thuế thu nhập doanh nghiệp",
    },
    { id: "profit_parent", rowCode: "61", page: 12, match: "(?:cổ đông|Cổ đông).*công ty mẹ" },
    { id: "financial_income", rowCode: "22", page: 12, match: "Doanh thu hoạt động tài chính" },
    {
      id: "operating_profit",
      rowCode: "30",
      page: 12,
      match: "Lợi nhuận thuần từ hoạt động kinh doanh",
    },
    {
      id: "operating_cash_flow",
      rowCode: "20",
      page: 13,
      match: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
    },
  ],
  "acb-h1-2026": [
    { id: "net_interest_income", rowCode: "I", page: 10, match: "^I\\s+Thu nhập lãi thuần" },
    {
      id: "net_fee_income",
      rowCode: "II",
      page: 10,
      match: "^II\\s+Lãi thuần từ hoạt động dịch vụ",
    },
    { id: "operating_expenses", rowCode: "VIII", page: 10, match: "^VIII\\s+Chi phí hoạt động" },
    {
      id: "operating_profit_before_provision",
      rowCode: "IX",
      page: 10,
      match: "^trước chi phí dự phòng rủi ro tín dụng",
    },
    {
      id: "credit_loss_provision",
      rowCode: "X",
      page: 10,
      match: "^X\\s+Chi phí dự phòng rủi ro tín dụng",
    },
    { id: "profit_before_tax", rowCode: "XI", page: 10, match: "^XI\\s+Tổng lợi nhuận trước thuế" },
    { id: "profit_after_tax", rowCode: "XIII", page: 10, match: "^XIII\\s+Lợi nhuận sau thuế" },
    {
      id: "bank_operating_cash_flow",
      rowCode: "I",
      page: 11,
      match: "^I\\s+LƯU CHUYỂN TIỀN THUẦN TỪ HOẠT ĐỘNG KINH DOANH",
    },
  ],
});

export function sourceVersion(source) {
  return `sha256:${source.hash}`;
}

export function sourceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = /^(?:unsupported_|ambiguous_|invalid_|unsafe_|query_|private_)/.test(code)
    ? 422
    : code === "cancelled"
      ? 409
      : code === "timeout"
        ? 504
        : 502;
  Object.assign(error, details);
  return error;
}

export function sourceIssuerForUrl(input) {
  const url = new URL(validateSecuritiesSourceUrl(input));
  return {
    "fpt.com": "FPT",
    "bctn2025.fpt.com": "FPT",
    "www.gemadept.com.vn": "GMD",
    "viconship.com": "VSC",
    "acb.com.vn": "ACB",
  }[url.hostname];
}

/** An exact host and narrow resource family are mandatory, even for redirects. */
export function validateSecuritiesSourceUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw sourceError("unsafe_url");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    /%2f|%5c|%00|%2e/i.test(url.pathname)
  )
    throw sourceError("unsafe_url");
  const routes = {
    "fpt.com": [
      /^\/api\/media\/[a-zA-Z0-9_.-]+\.pdf$/,
      /^\/vi\/nha-dau-tu\/(thong-tin-cong-bo|bao-cao)\/?$/,
      /^\/vi\/dieu-khoan-su-dung\/?$/,
    ],
    "bctn2025.fpt.com": [/^\/$/, /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-zA-Z0-9_.-]+\.pdf$/],
    "www.gemadept.com.vn": [
      /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-zA-Z0-9_.-]+\.pdf$/,
      /^\/co-dong\/bao-cao-tai-chinh\/?$/,
      /^\/(?:gmd-|bao-cao-tai-chinh-)[a-z0-9-]+\/$/,
    ],
    "viconship.com": [
      /^\/co-dong\/?$/,
      /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-zA-Z0-9_.-]+\.pdf$/,
    ],
    "acb.com.vn": [
      /^\/vi\/nha-dau-tu\/bao-cao-tai-chinh-20\d{2}\/?$/,
      /^\/acbwebsite\/files\/(?=[^/]*acb)(?=[^/]*bctc)(?=[^/]*hop(?:%20|[_-])nhat)(?:[a-z0-9_.-]|%20)+\.pdf$/i,
    ],
  };
  if (!routes[url.hostname]?.some((pattern) => pattern.test(url.pathname)))
    throw sourceError("unsafe_url");
  return url.href;
}

export function parseVndToMillion(rawText) {
  return parseSourceAmountToMillion(rawText, "VND");
}

export function parseSourceAmountToMillion(rawText, originalUnit) {
  if (!["VND", "VND_million"].includes(originalUnit)) throw sourceError("unsupported_source_unit");
  if (rawText === null || rawText === undefined || rawText === "") return null;
  if (
    !/^(?:\(\s*|[-−]\s*)?\d{1,3}(?:[.,]\d{3})*(?:\s*\))?$/.test(rawText) ||
    (rawText.includes(".") && rawText.includes(",")) ||
    rawText.startsWith("(") !== rawText.endsWith(")")
  )
    throw sourceError("invalid_numeric_extraction");
  const negative = /^(?:\(|[-−])/.test(rawText);
  const digits = rawText.replace(/[().,−\s-]/g, "");
  const whole = BigInt(digits);
  const sign = negative ? "-" : "";
  return originalUnit === "VND_million"
    ? `${sign}${whole}.000000`
    : `${sign}${whole / 1000000n}.${String(whole % 1000000n).padStart(6, "0")}`;
}
