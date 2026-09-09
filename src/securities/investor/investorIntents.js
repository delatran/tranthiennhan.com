import { periodLabel } from "../format.js";

export const INVESTOR_INTENTS = ["business", "earnings", "disclosures"];

export function investorCopy(locale = "vi", sectorId) {
  const banking = sectorId === "banking";
  return locale === "vi"
    ? {
        chooseIntent: "Bạn muốn hiểu điều gì?",
        intents: {
          business: {
            title: "Hiểu doanh nghiệp",
            detail: "Hoạt động & tăng trưởng",
            icon: "book",
          },
          earnings: {
            title: banking ? "Lợi nhuận & dự phòng" : "Lợi nhuận & dòng tiền",
            detail: banking ? "Thu nhập, chi phí & rủi ro tín dụng" : "Kết quả & điểm cần kiểm tra",
            icon: "file",
          },
          disclosures: {
            title: "Công bố gần đây",
            detail: "Tài liệu & cập nhật liên quan",
            icon: "search",
          },
        },
        question: "Câu hỏi của bạn",
        restoreQuestion: "Dùng câu hỏi gợi ý",
        sourceDetails: "Phạm vi nguồn",
        processed: "Có bộ báo cáo để phân tích",
        public: "Tra cứu nguồn công khai",
        noProcessed: "Chưa có bộ báo cáo đã xử lý",
        analyze: "Đọc & phân tích",
        research: "Tìm & đọc nguồn",
        researching: "Đang tìm và đọc nguồn…",
        publicScope:
          "Tìm nguồn theo mã và câu hỏi. Số liệu tìm được chưa được đối chiếu thành bộ báo cáo.",
        modelUnavailable: "AI chưa sẵn sàng. Bạn vẫn có thể xem dữ liệu bên dưới.",
        watchlist: "Theo dõi",
        add: "Theo dõi mã này",
        remove: "Bỏ theo dõi",
        saved: "Đang theo dõi",
        sessionOnly: "Chỉ lưu trong lần truy cập này",
        noSelection: "Chọn một mã để bắt đầu",
        reportPeriod: "Kỳ báo cáo",
        compare: "So với",
      }
    : {
        chooseIntent: "What would you like to understand?",
        intents: {
          business: {
            title: "Business overview",
            detail: "Activities & growth drivers",
            icon: "book",
          },
          earnings: {
            title: banking ? "Profit & provisions" : "Profit & cash flow",
            detail: banking ? "Income, costs & credit risk" : "Results & what to examine",
            icon: "file",
          },
          disclosures: {
            title: "Recent disclosures",
            detail: "Documents & relevant updates",
            icon: "search",
          },
        },
        question: "Your question",
        restoreQuestion: "Use suggested question",
        sourceDetails: "Source coverage",
        processed: "Report data available for analysis",
        public: "Public source research",
        noProcessed: "No processed report set yet",
        analyze: "Read & analyze",
        research: "Find & read sources",
        researching: "Finding and reading sources…",
        publicScope:
          "Find sources for this stock and question. Retrieved figures have not been reconciled into a report set.",
        modelUnavailable: "AI is unavailable. You can still explore the data below.",
        watchlist: "Watchlist",
        add: "Watch this stock",
        remove: "Remove from watchlist",
        saved: "Watching",
        sessionOnly: "Saved for this visit only",
        noSelection: "Choose a stock to begin",
        reportPeriod: "Reporting period",
        compare: "Compared with",
      };
}

export function researchMode(intent, company) {
  return intent === "disclosures" || !company ? "public" : "report";
}

export function investorQuestion({
  intent = "business",
  stock,
  period,
  comparison,
  locale = "vi",
  mode = "public",
  sectorId,
}) {
  const symbol = stock?.symbol;
  if (!symbol) return "";
  const selectedPeriod = mode === "report" && period ? periodLabel(period, locale) : "";
  const priorPeriod = selectedPeriod && comparison ? periodLabel(comparison, locale) : "";
  if (locale === "vi") {
    const scope = selectedPeriod ? ` trong ${selectedPeriod}` : "";
    const comparisonScope = priorPeriod ? ` so với ${priorPeriod}` : "";
    if (intent === "disclosures")
      return `Tìm những công bố gần đây của ${symbol}. Nêu tài liệu, ngày công bố và nội dung đáng chú ý, kèm liên kết nguồn gốc.`;
    if (sectorId === "banking") {
      if (intent === "earnings")
        return mode === "report"
          ? `Lợi nhuận của ${symbol}${scope}${comparisonScope} thay đổi ra sao? Phân tích thu nhập lãi thuần, thu nhập phí thuần, chi phí hoạt động, lợi nhuận trước dự phòng và chi phí dự phòng rủi ro tín dụng. Dẫn số liệu từ báo cáo và nêu điểm cần theo dõi.`
          : `Tìm báo cáo tài chính gần đây của ${symbol} và nguồn giải thích thu nhập lãi thuần, thu nhập phí, chi phí hoạt động, dự phòng rủi ro tín dụng và lợi nhuận. Nêu kỳ báo cáo và liên kết tài liệu gốc để đối chiếu.`;
      return mode === "report"
        ? `Giải thích hoạt động và kết quả kinh doanh của ${symbol}${scope}${comparisonScope}. Thu nhập lãi thuần, thu nhập phí và lợi nhuận thay đổi ra sao? Nêu động lực tăng trưởng, tác động của chi phí và dự phòng, cùng điểm cần theo dõi.`
        : `${symbol} cung cấp những dịch vụ ngân hàng nào? Tìm tài liệu chính thức giải thích các nguồn thu nhập, động lực tăng trưởng và rủi ro tín dụng của ngân hàng.`;
    }
    if (intent === "earnings")
      return mode === "report"
        ? `Lợi nhuận của ${symbol}${scope}${comparisonScope} có được hỗ trợ bởi dòng tiền kinh doanh không? Chỉ ra điểm cần xem kỹ và dẫn số liệu từ báo cáo.`
        : `Tìm báo cáo tài chính gần đây của ${symbol} và nguồn nói về lợi nhuận, dòng tiền kinh doanh. Nêu kỳ báo cáo và liên kết tài liệu gốc để đối chiếu.`;
    return mode === "report"
      ? `Giải thích kết quả kinh doanh của ${symbol}${scope}${comparisonScope}. Doanh thu và lợi nhuận thay đổi ra sao, điều gì hỗ trợ tăng trưởng và điểm nào cần theo dõi?`
      : `${symbol} kinh doanh gì và có những mảng hoạt động nào? Tìm tài liệu chính thức giải thích hoạt động, động lực tăng trưởng và rủi ro của doanh nghiệp.`;
  }
  const scope = selectedPeriod ? ` in ${selectedPeriod}` : "";
  const comparisonScope = priorPeriod ? ` compared with ${priorPeriod}` : "";
  if (intent === "disclosures")
    return `Find recent disclosures from ${symbol}. List the documents, publication dates and notable content, with original source links.`;
  if (sectorId === "banking") {
    if (intent === "earnings")
      return mode === "report"
        ? `How did ${symbol}'s profit change${scope}${comparisonScope}? Examine net interest income, net fee income, operating expenses, operating profit before provisions and credit loss provisions. Cite report figures and identify what to watch.`
        : `Find recent financial statements from ${symbol} and sources explaining net interest income, fee income, operating expenses, credit loss provisions and profit. Identify the reporting period and link the original documents for reconciliation.`;
    return mode === "report"
      ? `Explain ${symbol}'s banking activities and business performance${scope}${comparisonScope}. How have net interest income, fee income and profit changed? Explain growth drivers, the impact of costs and provisions, and what to watch.`
      : `Which banking services does ${symbol} provide? Find official documents explaining the bank's income sources, growth drivers and credit risks.`;
  }
  if (intent === "earnings")
    return mode === "report"
      ? `Is ${symbol}'s profit${scope} supported by operating cash flow${comparisonScope}? Identify what deserves closer review and cite the report figures.`
      : `Find recent financial statements from ${symbol} and sources covering profit and operating cash flow. Identify the reporting period and link the original documents for reconciliation.`;
  return mode === "report"
    ? `Explain ${symbol}'s business performance${scope}${comparisonScope}. How have revenue and profit changed, what supports growth, and what should I watch?`
    : `What does ${symbol} do and what are its business segments? Find official documents explaining its activities, growth drivers and business risks.`;
}
