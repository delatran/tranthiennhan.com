import {
  SECURITIES_ISSUERS,
  SECURITIES_METRICS,
  SECURITIES_SOURCE_DOCUMENTS,
  parseSourceAmountToMillion,
  sourceError,
  sourceVersion,
} from "./source-contract.js";

export const SECURITIES_CATALOG_VERSION = "2026-09-08-verified-public-sources-v4-acb-quotes";
export const SECURITIES_CATALOG_FROZEN_AT = "2026-09-08T10:50:01.884Z";

// Original PDF extraction and separately reviewed transcriptions are bound to source/cell hashes.
export const VERIFIED_CELLS_DIGESTS = Object.freeze({
  "fpt-annual-2025": "8c7f18c4f7a5399ec9cbfbdee4fa23071906c1b63c5cabe0e9c61e4a9ea894e5",
  "fpt-h1-2026": "f0ab843ea264cf9137fd80e2532434333541c31254e8c6536c2837ab37755729",
  "gmd-h1-2026": "9b39a8dc1f1498677f0ab03c7b28c05cc2d6cdd8c7303850c75ae9cd32fc7470",
  "vsc-h1-2026": "d16835c59b723c7f0c198c803bbcb6224dde7080644c6cc35fec9b6991cf5831",
  "acb-h1-2026": "18972fd4941ce26ec867afc664aadc76d34bae6083592ef6c8a0df253563f263",
});

// BEGIN GENERATED SOURCE CELLS
const FROZEN_CELLS = {
  "fpt-h1-2026": [
    {
      id: "revenue",
      page: 18,
      rowCode: "10",
      rawCurrent: "26.268.500.667.974",
      rawComparison: "23.325.685.794.923",
      rawReportedComparison: "32.682.853.982.527",
      rawRow:
        "Doanh thu thuần về bán hàng và cung cấp dịch vụ 10 26.268.500.667.974 32.682.853.982.527 23.325.685.794.923 2.942.814.873.051 12,6%",
      extractionIssue: null,
    },
    {
      id: "profit_before_tax",
      page: 18,
      rowCode: "50",
      rawCurrent: "5.714.236.316.160",
      rawComparison: "4.837.503.416.147",
      rawReportedComparison: "6.165.726.095.309",
      rawRow:
        "Tổng lợi nhuận kế toán trước thuế 50 5.714.236.316.160 6.165.726.095.309 4.837.503.416.147 876.732.900.013 18,1%",
      extractionIssue: null,
    },
    {
      id: "profit_after_tax",
      page: 18,
      rowCode: "60",
      rawCurrent: "5.047.128.933.102",
      rawComparison: "4.427.462.420.799",
      rawReportedComparison: "5.335.828.880.987",
      rawRow:
        "Lợi nhuận sau thuế thu nhập doanh nghiệp 60 5.047.128.933.102 5.335.828.880.987 4.427.462.420.799 619.666.512.303 14,0%",
      extractionIssue: null,
    },
    {
      id: "profit_parent",
      page: 18,
      rowCode: "61",
      rawCurrent: "5.054.958.601.533",
      rawComparison: "4.431.763.974.648",
      rawReportedComparison: "4.431.763.974.648",
      rawRow:
        "- Lợi nhuận sau thuế của Cổ đông Công ty mẹ 61 5.054.958.601.533 4.431.763.974.648 4.431.763.974.648 623.194.626.885 14,1%",
      extractionIssue: null,
    },
  ],
  "fpt-annual-2025": [
    {
      id: "revenue",
      page: 169,
      rowCode: "10",
      rawCurrent: "70.112.825.100.710",
      rawComparison: "62.848.794.351.367",
      rawRow:
        "10 Doanh thu thuần về bán hàng và cung cấp dịch vụ (10 = 01 – 02) 26 70.112.825.100.710 62.848.794.351.367",
      extractionIssue: null,
    },
    {
      id: "gross_profit",
      page: 169,
      rowCode: "20",
      rawCurrent: "25.888.529.512.413",
      rawComparison: "23.698.348.369.916",
      rawRow:
        "05 PHÂN TÍCH HOẠT ĐỘNG KINH DOANH 20 Lợi nhuận gộp về bán hàng và cung cấp dịch vụ (20 = 10 – 11) 25.888.529.512.413 23.698.348.369.916",
      extractionIssue: null,
    },
    {
      id: "profit_before_tax",
      page: 169,
      rowCode: "50",
      rawCurrent: "13.043.632.833.797",
      rawComparison: "11.069.666.417.819",
      rawRow:
        "50 Tổng lợi nhuận kế toán trước thuế (50 = 30 + 40) 13.043.632.833.797 11.069.666.417.819",
      extractionIssue: null,
    },
    {
      id: "profit_after_tax",
      page: 170,
      rowCode: "60",
      rawCurrent: "11.232.339.450.734",
      rawComparison: "9.427.422.530.444",
      rawRow: "60 Lợi nhuận sau thuế TNDN (60 = 50 – 51 – 52) 11.232.339.450.734 9.427.422.530.444",
      extractionIssue: null,
    },
    {
      id: "profit_parent",
      page: 170,
      rowCode: "61",
      rawCurrent: "9.376.127.629.501",
      rawComparison: "7.856.767.812.178",
      rawRow: "61 Cổ đông của công ty mẹ 9.376.127.629.501 7.856.767.812.178",
      extractionIssue: null,
    },
  ],
  "gmd-h1-2026": [
    {
      id: "revenue",
      page: 11,
      rowCode: "10",
      rawCurrent: "3.213.959.441.395",
      rawComparison: "2.770.677.739.218",
      rawRow:
        "3. Doanh thu thuần về bán hàng va cung cấp dịch vụ 10 3.213.959.441.395 2.770.677.739.218",
      extractionIssue: null,
    },
    {
      id: "gross_profit",
      page: 11,
      rowCode: "20",
      rawCurrent: "1.560.813.719.489",
      rawComparison: "1.283.613.314.736",
      rawRow:
        "5. Lợi nhuận gộp về bán hàng và cung cấp dịch vụ 20 1.560.813.719.489 1.283.613.314.736 ‘0",
      extractionIssue: null,
    },
    {
      id: "profit_before_tax",
      page: 11,
      rowCode: "50",
      rawCurrent: "2.267.360.938.616",
      rawComparison: "1.260.549.109.752",
      rawRow: "16. Tổng lợi nhuận kế toán trước thué 50 2.267.360.938.616 1.260.549.109.752 VÀ",
      extractionIssue: null,
    },
    {
      id: "profit_after_tax",
      page: 11,
      rowCode: "60",
      rawCurrent: "1.938.610.299.268",
      rawComparison: "1.131.775.875.175",
      rawRow: "19. Lợi nhuận sau thuế thu nhập doanh nghiệp 60 1.938.610.299.268 1.131.775.875.175",
      extractionIssue: null,
    },
    {
      id: "profit_parent",
      page: 11,
      rowCode: "61",
      rawCurrent: "1.658.394.158.581",
      rawComparison: "848.236.864.657",
      rawRow: "20. Lợi nhuận sau thuế của công ty mẹ 61 1.658.394.158.581 848.236.864.657",
      extractionIssue: null,
    },
    {
      id: "financial_income",
      page: 11,
      rowCode: "22",
      rawCurrent: "749.692.570.788",
      rawComparison: "91.517.551.504",
      rawRow: "7. Doanh thu hoạt động tài chính 2. VI3 749.692.570.788 91.517.551.504 a",
      extractionIssue: null,
    },
    {
      id: "operating_profit",
      page: 11,
      rowCode: "30",
      rawCurrent: "2.313.272.374.440",
      rawComparison: "1.378.701.295.090",
      rawRow: "12. Lợi nhuận thuần từ hoạt động kinh doanh 30 2.313.272.374.440 1.378.701.295.090",
      extractionIssue: null,
    },
    {
      id: "operating_cash_flow",
      page: 12,
      rowCode: "20",
      rawCurrent: "1.023.998.149.944",
      rawComparison: "1.090.272.860.986",
      rawRow:
        "Lưu chuyển tiền thuần từ hoạt động kinh doanh 20 1.023.998.149.944 1.090.272.860.986 70",
      extractionIssue: null,
    },
  ],
  "vsc-h1-2026": [
    {
      id: "revenue",
      page: 12,
      rowCode: "10",
      rawCurrent: "1.721.819.309.583",
      rawComparison: "1.489.029.514.792",
      rawRow: "Doanh thu thuần 10 1.721.819.309.583 1.489.029.514.792",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "gross_profit",
      page: 12,
      rowCode: "20",
      rawCurrent: "707.201.354.975",
      rawComparison: "481.173.530.433",
      rawRow: "Lợi nhuận gộp 20 707.201.354.975 481.173.530.433",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "profit_before_tax",
      page: 12,
      rowCode: "50",
      rawCurrent: "380.900.694.870",
      rawComparison: "311.958.819.464",
      rawRow: "Lợi nhuận trước thuế 50 380.900.694.870 311.958.819.464",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "profit_after_tax",
      page: 12,
      rowCode: "60",
      rawCurrent: "313.595.235.914",
      rawComparison: "259.917.492.635",
      rawRow: "Lợi nhuận sau thuế 60 313.595.235.914 259.917.492.635",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "profit_parent",
      page: 12,
      rowCode: "61",
      rawCurrent: "199.140.402.733",
      rawComparison: "196.876.420.745",
      rawRow: "LNST thuộc cổ đông công ty mẹ 61 199.140.402.733 196.876.420.745",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "financial_income",
      page: 12,
      rowCode: "22",
      rawCurrent: "72.426.230.360",
      rawComparison: "100.831.612.978",
      rawRow: "Doanh thu tài chính 22 72.426.230.360 100.831.612.978",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "operating_profit",
      page: 12,
      rowCode: "30",
      rawCurrent: "380.088.084.819",
      rawComparison: "291.204.653.921",
      rawRow: "Lợi nhuận thuần từ HĐKD 30 380.088.084.819 291.204.653.921",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "operating_cash_flow",
      page: 13,
      rowCode: "20",
      rawCurrent: "364.275.715.936",
      rawComparison: "(445.314.319.497)",
      rawRow: "Dòng tiền thuần từ hoạt động kinh doanh 20 364.275.715.936 (445.314.319.497)",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
  ],
  "acb-h1-2026": [
    {
      id: "net_interest_income",
      page: 10,
      rowCode: "I",
      rawCurrent: "14.773.853",
      rawComparison: "13.042.713",
      rowLabel: "Thu nhập lãi thuần",
      rawRow: "I Thu nhập lãi thuần 14.773.853 13.042.713",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "net_fee_income",
      page: 10,
      rowCode: "II",
      rawCurrent: "1.818.343",
      rawComparison: "1.457.044",
      rowLabel: "Lãi thuần từ hoạt động dịch vụ",
      rawRow: "II Lãi thuần từ hoạt động dịch vụ 1.818.343 1.457.044",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "operating_expenses",
      page: 10,
      rowCode: "VIII",
      rawCurrent: "(5.566.330)",
      rawComparison: "(5.428.052)",
      rowLabel: "Chi phí hoạt động",
      rawRow: "VIII Chi phí hoạt động 29 (5.566.330) (5.428.052)",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "operating_profit_before_provision",
      page: 10,
      rowCode: "IX",
      rawCurrent: "12.481.235",
      rawComparison: "11.779.120",
      rowLabel: "Lợi nhuận thuần từ hoạt động kinh doanh trước chi phí dự phòng rủi ro tín dụng",
      rawRow:
        "IX Lợi nhuận thuần từ hoạt động kinh doanh trước chi phí dự phòng rủi ro tín dụng 12.481.235 11.779.120",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "credit_loss_provision",
      page: 10,
      rowCode: "X",
      rawCurrent: "(1.746.196)",
      rawComparison: "(1.089.167)",
      rowLabel: "Chi phí dự phòng rủi ro tín dụng",
      rawRow: "X Chi phí dự phòng rủi ro tín dụng 30 (1.746.196) (1.089.167)",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "profit_before_tax",
      page: 10,
      rowCode: "XI",
      rawCurrent: "10.735.039",
      rawComparison: "10.689.953",
      rowLabel: "Tổng lợi nhuận trước thuế",
      rawRow: "XI Tổng lợi nhuận trước thuế 10.735.039 10.689.953",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "profit_after_tax",
      page: 10,
      rowCode: "XIII",
      rawCurrent: "8.612.866",
      rawComparison: "8.559.425",
      rowLabel: "Lợi nhuận sau thuế",
      rawRow: "XIII Lợi nhuận sau thuế 8.612.866 8.559.425",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
    {
      id: "bank_operating_cash_flow",
      page: 11,
      rowCode: "I",
      rawCurrent: "(42.374.834)",
      rawComparison: "(9.800.290)",
      rowLabel: "LƯU CHUYỂN TIỀN THUẦN TỪ HOẠT ĐỘNG KINH DOANH",
      rawRow: "I LƯU CHUYỂN TIỀN THUẦN TỪ HOẠT ĐỘNG KINH DOANH (42.374.834) (9.800.290)",
      normalization: "visually_verified_transcription",
      extractionIssue: null,
    },
  ],
};
// END GENERATED SOURCE CELLS

// Independent visual transcriptions bind reviewed material cells to the original pages.
// The collector must verify these original/page hashes before using the reviewed cells.
const REVIEWED_TRANSCRIPTIONS = Object.freeze({
  "vsc-h1-2026": Object.freeze({
    sourceHash: "6ead1d852b12f468da71dc3e1ea830549124e99ec073078008051a540402862d",
    cellsDigest: "d16835c59b723c7f0c198c803bbcb6224dde7080644c6cc35fec9b6991cf5831",
    oracleSha256: "2d1eeb7d74a1f7c28f56ae1a51123257a555a06ea486b61fb38f1cbd0da26c9b",
    method: "visual_original_transcription",
    pageRenderHashes: {
      12: "964f349391b7464d29160e1e923f77c79fd56bbbd6898a4ed9e094e5d34efdb3",
      13: "918cc3d28a457206a24a473cacc3c13c2679c33bb72486bc17523aefa7e213c3",
    },
  }),
  "acb-h1-2026": Object.freeze({
    sourceHash: "639ecab36c0d6444e80db53bd9043552bcfcfa2df9a7b52be35fdae18fbe6701",
    cellsDigest: "18972fd4941ce26ec867afc664aadc76d34bae6083592ef6c8a0df253563f263",
    oracleSha256: "1eb8b8265d067768231cd2c512b36c0795744c56c0809fe5a045d564d6695907",
    quoteCorrectionSha256: "3cf5b95a6da32f301923644d5338c3468c288172b18f9d449e25f0ef4f131afe",
    method: "visual_original_transcription",
    pageRenderHashes: {
      10: "3629ea21bb49f8e48376424329c50a6540a0aa6cc600f70dd78b91b18a27bb21",
      11: "7895f6bc0dd1d8bfa44d4a9865b1698d953073e36cbf13ca235d5973b22572fe",
    },
  }),
});

export function getReviewedSecuritiesSourceCells(sourceId, sourceHash) {
  const review = REVIEWED_TRANSCRIPTIONS[sourceId];
  if (!review || review.sourceHash !== sourceHash) return null;
  return structuredClone({ ...review, sourceId, cells: FROZEN_CELLS[sourceId] });
}

const labels = (vi, en) => ({ vi, en });
const period = (id, year, kind, label, extra = {}) => ({
  id,
  label,
  start: `${year}-01-01`,
  end: `${year}-${kind === "annual" ? "12-31" : "06-30"}`,
  kind,
  scope: "consolidated",
  ...extra,
});
const PERIODS = {
  FY2025: period("FY2025", 2025, "annual", labels("Năm 2025", "FY 2025"), {
    comparisonPeriodId: "FY2024",
  }),
  FY2024: period("FY2024", 2024, "annual", labels("Năm 2024", "FY 2024")),
  H1_2026: period("H1_2026", 2026, "half_year", labels("6 tháng 2026", "H1 2026")),
  H1_2025: period("H1_2025", 2025, "half_year", labels("6 tháng 2025", "H1 2025")),
  H1_2025_restated: period(
    "H1_2025_restated",
    2025,
    "half_year",
    labels("6 tháng 2025 · cùng phương pháp", "H1 2025 · comparable basis"),
    { basisId: "ftel_equity_method", presentation: "issuer_represented_comparator" },
  ),
  H1_2025_reported: period(
    "H1_2025_reported",
    2025,
    "half_year",
    labels("6 tháng 2025 · hợp nhất FTEL", "H1 2025 · including FTEL"),
    { basisId: "ftel_full_consolidation", presentation: "prior_reviewed_reclassified" },
  ),
};

function sourcePeriod(id) {
  if (PERIODS[id]) return PERIODS[id];
  const match = /^(FY|H1_)(20\d{2})$/u.exec(id || "");
  if (!match) return null;
  const annual = match[1] === "FY";
  return period(
    id,
    Number(match[2]),
    annual ? "annual" : "half_year",
    labels(
      annual ? `Năm ${match[2]}` : `6 tháng ${match[2]}`,
      annual ? `FY ${match[2]}` : `H1 ${match[2]}`,
    ),
  );
}

function sourceNotes(source) {
  if (
    !SECURITIES_SOURCE_DOCUMENTS.some(
      (entry) => entry.id === source.id && entry.hash === source.hash,
    )
  )
    return [];
  if (source.id === "fpt-h1-2026")
    return [
      {
        id: "ftel-method",
        page: 12,
        note: "(i)",
        quote:
          "Từ ngày 01 tháng 01 năm 2026, Tập đoàn đã thay đổi phương pháp hợp nhất báo cáo tài chính đối với Công ty Cổ phần Viễn thông FPT (FTEL), từ hợp nhất toàn bộ (áp dụng đối với công ty con) sang hợp nhất theo phương pháp vốn chủ sở hữu",
        text: labels(
          "Từ 01/01/2026, FTEL chuyển từ hợp nhất toàn bộ sang phương pháp vốn chủ sở hữu. Đối chiếu cùng kỳ cần lựa chọn cơ sở rõ ràng.",
          "From 1 January 2026, FTEL moved from full consolidation to the equity method. The comparison must identify its accounting basis.",
        ),
      },
      {
        id: "same-method",
        page: 18,
        note: "1. Cấu trúc doanh nghiệp",
        quote:
          "chúng tôi đã trình bày lại số liệu 6 tháng đầu năm 2025 theo cùng một phương pháp kế toán như năm 2026",
        text: labels(
          "Mặc định dùng cột 2025 do chính FPT trình bày lại theo cùng phương pháp kế toán với 2026 tại thuyết minh 1. Đây không phải ước tính của analyst.",
          "The default uses the 2025 comparator re-presented by FPT under the same accounting method as 2026 in note 1. It is not an analyst estimate.",
        ),
      },
      {
        id: "negative-nci",
        page: 18,
        note: "1. Cấu trúc doanh nghiệp",
        quote: "Lợi nhuận sau thuế của Cổ đông không kiểm soát",
        text: labels(
          "Lợi nhuận thuộc cổ đông công ty mẹ cao hơn lợi nhuận sau thuế hợp nhất vì phần lợi nhuận cổ đông không kiểm soát âm; không tự coi đây là lỗi số liệu.",
          "Profit attributable to the parent exceeds consolidated profit because non-controlling interests recorded a loss. This is not by itself a data error.",
        ),
      },
    ];
  if (source.id === "gmd-h1-2026")
    return [
      {
        id: "disposal-gain",
        page: 48,
        note: "VI.3",
        quote: "Lãi chuyển nhượng khoản đầu tư tài chính dài hạn 599.837.509.022",
        text: labels(
          "Thuyết minh VI.3 ghi nhận lãi chuyển nhượng khoản đầu tư tài chính dài hạn. Cần tách khoản này khi đánh giá tính lặp lại của lợi nhuận.",
          "Note VI.3 reports a gain on disposal of a long-term financial investment. Assess this separately when considering earnings recurrence.",
        ),
      },
      {
        id: "port-revenue",
        page: 47,
        note: "VI.1a",
        quote: "Doanh thu hoạt động khai thác cảng 2.835.549.085.589 2.447.088.479.874",
        text: labels(
          "Thuyết minh VI.1a tách doanh thu khai thác cảng khỏi logistics và doanh thu khác, hỗ trợ xem cơ cấu doanh thu.",
          "Note VI.1a separates port revenue from logistics and other revenue, supporting review of the revenue mix.",
        ),
      },
      {
        id: "interest-difference",
        page: 48,
        note: "VI.4; đối chiếu trang PDF 11",
        quote: "Chi phí đi vay 84.903.781.994 49.767.022.846",
        text: labels(
          "Chi phí đi vay tại thuyết minh VI.4 khác dòng trong BCKQKD trang PDF 11. Chỉ tiêu này chưa được chuẩn hóa hoặc dùng để tính lãi vay.",
          "Borrowing costs in note VI.4 differ from the line on PDF page 11. This metric has not been normalized or used for interest calculations.",
        ),
      },
    ];
  if (source.id === "vsc-h1-2026")
    return [
      {
        id: "vsc-earnings-drivers",
        page: 1,
        note: "Giải trình biến động lợi nhuận bán niên",
        quote: "Lãi từ công ty liên kết",
        text: labels(
          "VSC giải thích lợi nhuận tăng nhờ lợi nhuận gộp và phần lãi từ công ty liên kết, trong khi chi phí tài chính tăng làm giảm mức tăng chung. Đây là giải thích của doanh nghiệp; cần đọc cùng BCTC.",
          "VSC attributes higher profit to gross profit and earnings from associates, partly offset by higher finance costs. This is the issuer's explanation and should be read with the statements.",
        ),
      },
      {
        id: "vsc-parent-profit",
        page: 12,
        note: "Báo cáo kết quả hoạt động kinh doanh",
        quote: "Cổ đông không kiểm soát",
        text: labels(
          "Lợi nhuận sau thuế hợp nhất gồm phần cổ đông không kiểm soát. Dùng dòng lợi nhuận thuộc cổ đông công ty mẹ khi đối chiếu quyền lợi cổ đông VSC.",
          "Consolidated profit after tax includes non-controlling interests. Use profit attributable to the parent when comparing earnings belonging to VSC shareholders.",
        ),
      },
      {
        id: "vsc-cfo-negative-base",
        page: 13,
        note: "Báo cáo lưu chuyển tiền tệ; chỉ tiêu 20",
        quote: "Lưu chuyển tiền thuần từ hoạt động kinh doanh",
        text: labels(
          "Dòng tiền kinh doanh chuyển từ âm ở cột cùng kỳ sang dương trong kỳ hiện tại. Mẫu số âm không hỗ trợ tỷ lệ tăng trưởng thông thường.",
          "Operating cash flow moved from a negative prior-period amount to a positive current amount. A negative base does not support a conventional growth percentage.",
        ),
      },
      {
        id: "vsc-cfo-trading-securities",
        page: 13,
        note: "Báo cáo lưu chuyển tiền tệ; chỉ tiêu 13",
        quote: "Giảm/(tăng) chứng khoán kinh doanh",
        metricIds: ["operating_cash_flow"],
        locator: {
          page: 13,
          printedPage: "9",
          table: "Báo cáo lưu chuyển tiền tệ hợp nhất",
          rowCode: "13",
          precision: "page",
        },
        text: labels(
          "Dòng tiền kinh doanh của VSC bao gồm biến động chứng khoán kinh doanh. Khi đọc CFO/LNST, cần xem riêng cấu phần này.",
          "VSC's reported operating cash flow includes changes in trading securities. Read that component alongside the CFO/PAT ratio.",
        ),
      },
    ];
  if (source.id !== "fpt-annual-2025") return [];
  return [
    {
      id: "annual-audit",
      page: 164,
      note: "Báo cáo kiểm toán độc lập",
      quote: "phản ánh trung thực và hợp lý",
      text: labels(
        "Phần BCTC hợp nhất trong báo cáo thường niên có báo cáo kiểm toán độc lập ngày 19/03/2026; số so sánh năm 2024 nằm trong cùng BCTC.",
        "The consolidated financial statements include the independent audit report dated 19 March 2026, with the 2024 comparatives in the same statements.",
      ),
    },
    {
      id: "annual-ftel",
      page: 175,
      note: "1. Thông tin chung",
      quote: "phương pháp vốn chủ sở hữu",
      text: labels(
        "FY2025 và FY2024 phản ánh phạm vi hợp nhất của BCTC năm 2025. Thay đổi đối với FTEL có hiệu lực từ 2026; không ghép trực tiếp các số năm này với kỳ 2026.",
        "FY2025 and FY2024 reflect the consolidation scope in the 2025 statements. The FTEL change takes effect in 2026, so these figures must not be mixed directly with a 2026 period.",
      ),
    },
  ];
}

export function buildSecuritiesDataset(
  sourceInput,
  cells,
  { verified = false, comparisonPeriodId, excerpts = [], extraction = null, freshness = null } = {},
) {
  const source = structuredClone(sourceInput);
  const company = SECURITIES_ISSUERS.find((entry) => entry.id === source.companyId);
  if (!company || !Array.isArray(cells) || !cells.length)
    throw sourceError("invalid_source_dataset");
  const restated = source.id === "fpt-h1-2026";
  const sourceYear = Number(source.periodId.match(/20\d{2}/u)?.[0]);
  const comparisonId =
    comparisonPeriodId ||
    (restated
      ? "H1_2025_restated"
      : `${source.periodId.startsWith("FY") ? "FY" : "H1_"}${sourceYear - 1}`);
  const currentPeriod = { ...sourcePeriod(source.periodId), comparisonPeriodId: comparisonId };
  const comparison = sourcePeriod(comparisonId);
  if (!currentPeriod.id || !comparison) throw sourceError("unsupported_period");
  const reported = comparisonId === "H1_2025_reported";
  const basis = restated ? "ftel_equity_method" : "source_reported";
  const version = sourceVersion(source);
  const materialNotes = verified ? sourceNotes(source) : [];
  const document = {
    ...source,
    version,
    parserVersion: "securities-pdfjs6-tesseract7-v1",
    localOriginalUrl: `/api/securities/sources/documents/${source.id}/${source.hash}/original`,
    localPageUrl: `/api/securities/sources/documents/${source.id}/${source.hash}/pages/`,
    extraction: extraction || {
      fullOriginalFetched: true,
      materialCellsVerified: verified,
      method:
        source.sourceType === "scan_pdf"
          ? "local_ocr_then_visual_check"
          : "text_coordinates_then_visual_check",
    },
    excerpts: [
      ...cells
        .filter((cell) => cell.rawRow)
        .map((cell) => ({
          id: `row-${cell.id}`,
          text: cell.rawRow,
          locator: { page: cell.page, rowCode: cell.rowCode, precision: "cell" },
          ...(cell.normalization ? { normalization: cell.normalization } : {}),
        })),
      ...materialNotes.map((note) => ({
        id: note.id,
        text: note.quote,
        locator: note.locator || { page: note.page, note: note.note, precision: "page" },
        normalization: "visually_verified_transcription",
      })),
      ...excerpts,
    ],
  };
  const metrics = cells.map((cell) => {
    const definition = SECURITIES_METRICS[cell.id];
    if (!definition) throw sourceError("unsupported_metric");
    const point = (raw, selectedPeriod, comparisonSide) => ({
      value: raw === null ? null : parseSourceAmountToMillion(raw, source.unit),
      rawText: raw,
      originalUnit: source.unit,
      unit: "VND_million",
      sourceId: source.id,
      sourceVersion: version,
      entityId: company.id,
      periodId: selectedPeriod.id,
      scope: "consolidated",
      dataKind: "actual",
      basisId: comparisonSide && reported ? "ftel_full_consolidation" : basis,
      locator: {
        page: cell.page,
        printedPage: Number.isInteger(source.printedPageOffset)
          ? String(cell.page + source.printedPageOffset)
          : null,
        table:
          definition.statement === "cash_flow"
            ? "Báo cáo lưu chuyển tiền tệ hợp nhất"
            : restated
              ? "Thuyết minh 1 · Thông tin so sánh"
              : "Báo cáo kết quả hoạt động kinh doanh hợp nhất",
        rowCode: cell.rowCode,
        rowLabel: cell.rowLabel || definition.label.vi,
        column: comparisonSide
          ? restated
            ? reported
              ? "Số liệu sau hợp nhất FTEL là công ty con (2025)"
              : "Số liệu không hợp nhất FTEL là công ty con (2025)"
            : comparison.label.vi
          : currentPeriod.label.vi,
        precision: "cell",
      },
      verification:
        raw === null ? "missing" : verified && !cell.extractionIssue ? "verified" : "needs_review",
      extractionIssue: cell.extractionIssue || null,
    });
    const rate =
      restated && !reported ? cell.rawRow?.match(/(?:^|\s)([-−]?\d+(?:[,.]\d+)?)%\s*$/u) : null;
    const reportedChangePct = rate
      ? {
          value: Number(rate[1].replace("−", "-").replace(",", ".")),
          displayDecimals: (rate[1].split(/[,.]/u)[1] || "").length,
          rawText: rate[0].trim(),
          sourceId: source.id,
          sourceVersion: version,
          locator: {
            page: cell.page,
            rowCode: cell.rowCode,
            column: "Tăng trưởng · cùng phương pháp",
            precision: "cell",
          },
        }
      : undefined;
    return {
      id: cell.id,
      ...definition,
      unit: "VND_million",
      current: point(cell.rawCurrent, currentPeriod, false),
      comparison: point(
        reported ? (cell.rawReportedComparison ?? cell.rawComparison) : cell.rawComparison,
        comparison,
        true,
      ),
      ...(reportedChangePct ? { reportedChangePct } : {}),
    };
  });
  const issues = [];
  if (!verified)
    issues.push({
      id: "source-verification-required",
      severity: "material",
      code: "source_verification_required",
      message: labels(
        "Nguồn hoặc kết quả trích xuất mới cần đối chiếu các ô trọng yếu với bản gốc trước khi duyệt.",
        "A new source or extraction requires material cells to be checked against the original before approval.",
      ),
      sourceIds: [source.id],
      metricIds: metrics.map((metric) => metric.id),
    });
  if (reported)
    issues.push({
      id: "ftel-basis-discontinuity",
      severity: "material",
      code: "accounting_basis_changed",
      message: labels(
        "Cột 2025 này hợp nhất FTEL toàn bộ, trong khi 2026 dùng phương pháp vốn chủ sở hữu. Chuyển sang cột cùng phương pháp để tính tăng trưởng so sánh được.",
        "This 2025 column fully consolidates FTEL while 2026 uses the equity method. Select the comparable basis for like-for-like growth.",
      ),
      sourceIds: [source.id],
      metricIds: metrics.map((metric) => metric.id),
    });
  if (verified && source.id === "gmd-h1-2026")
    issues.push({
      id: "gmd-nonrecurring-financial-income",
      severity: "warning",
      code: "nonrecurring_item",
      message: labels(
        "Doanh thu tài chính có lãi chuyển nhượng đầu tư; xem thuyết minh VI.3 trước khi ngoại suy lợi nhuận.",
        "Financial income contains an investment disposal gain; review note VI.3 before extrapolating earnings.",
      ),
      sourceIds: [source.id],
      metricIds: ["financial_income", "profit_before_tax", "profit_after_tax"],
    });
  return {
    schemaVersion: 1,
    company: structuredClone(company),
    period: currentPeriod,
    comparisonPeriod: structuredClone(comparison),
    comparisonBasis: restated
      ? reported
        ? labels(
            "Theo cột có hợp nhất FTEL; khác phạm vi với 2026",
            "FTEL fully consolidated; scope differs from 2026",
          )
        : labels(
            "Cùng phương pháp kế toán; FPT trình bày lại tại thuyết minh 1",
            "Same accounting method; issuer re-presented comparator in note 1",
          )
      : labels(
          "Cột so sánh trong cùng BCTC hợp nhất",
          "Comparative column in the same consolidated statements",
        ),
    sources: [document],
    metrics,
    issues,
    evidenceNotes: materialNotes.map((note) => ({
      ...note,
      sourceId: source.id,
      sourceVersion: version,
      kind: "source_statement",
      locator: note.locator || { page: note.page, note: note.note, precision: "page" },
    })),
    freshness: freshness || {
      status: "frozen",
      cachedAt: source.fetchedAt,
      checkedAt: source.fetchedAt,
      lastSuccessfulCheckAt: source.fetchedAt,
      latestMarketPeriodVerified: false,
      policy: "24h-issuer-discovery-and-content-hash",
      label: labels(
        `Nguồn công khai đã đóng băng ngày ${source.fetchedAt.slice(0, 10)}`,
        `Public-source snapshot frozen on ${source.fetchedAt.slice(0, 10)}`,
      ),
    },
  };
}

export function getFrozenSecuritiesDatasets() {
  return SECURITIES_SOURCE_DOCUMENTS.flatMap((source) => {
    const cells = FROZEN_CELLS[source.id];
    if (!cells) return [];
    const dataset = buildSecuritiesDataset(source, cells, { verified: true });
    return source.id === "fpt-h1-2026"
      ? [
          dataset,
          buildSecuritiesDataset(source, cells, {
            verified: true,
            comparisonPeriodId: "H1_2025_reported",
          }),
        ]
      : [dataset];
  });
}

function comparisonPriority(dataset) {
  if (dataset.comparisonPeriod.presentation === "issuer_represented_comparator") return 0;
  return dataset.metrics.every((metric) => metric.current.basisId === metric.comparison.basisId)
    ? 1
    : 2;
}

function issuersFromDatasets(datasets) {
  const companies = new Map(SECURITIES_ISSUERS.map((company) => [company.id, company]));
  for (const { company } of datasets) {
    if (
      !company ||
      !/^[A-Za-z0-9_-]{1,100}$/u.test(company.id ?? "") ||
      !/^[A-Z][A-Z0-9]{1,14}$/u.test(company.ticker ?? "") ||
      !["HOSE", "HNX", "UPCOM"].includes(company.exchange)
    )
      throw sourceError("invalid_source_dataset");
    const known = companies.get(company.id);
    if (known && (known.ticker !== company.ticker || known.exchange !== company.exchange))
      throw sourceError("source_company_mismatch");
    if (!known) companies.set(company.id, company);
  }
  return [...companies.values()];
}

export function catalogFromDatasets(datasets) {
  const companies = issuersFromDatasets(datasets);
  const coveredCompanyCount = new Set(datasets.map((dataset) => dataset.company.id)).size;
  return {
    version: SECURITIES_CATALOG_VERSION,
    frozenAt: SECURITIES_CATALOG_FROZEN_AT,
    defaultCompanyId: "FPT",
    defaultPeriodId: "H1_2026",
    mode: "verified_public_source_snapshot",
    companies: companies.map((company) => {
      const owned = datasets.filter((dataset) => dataset.company.id === company.id);
      const periods = [...new Set(owned.map((dataset) => dataset.period.id))]
        .map((id) => {
          const selected = owned
            .filter((dataset) => dataset.period.id === id)
            .sort((a, b) => comparisonPriority(a) - comparisonPriority(b));
          return {
            ...selected[0].period,
            comparisonOptions: selected.map((dataset) => dataset.comparisonPeriod),
            sources: selected[0].sources.map(({ id, title, publishedAt, sourceType }) => ({
              id,
              title,
              publishedAt,
              sourceType,
            })),
          };
        })
        .sort((a, b) => b.end.localeCompare(a.end));
      return {
        ...company,
        periods,
        defaultPeriodId: periods[0]?.id || null,
        available: periods.length > 0,
      };
    }),
    scopeNotice: labels(
      `Danh mục có dữ liệu hồ sơ của ${coveredCompanyCount} doanh nghiệp.`,
      `Dossier data is available for ${coveredCompanyCount} issuers in this catalog.`,
    ),
  };
}

export function getSecuritiesCatalog() {
  return catalogFromDatasets(getFrozenSecuritiesDatasets());
}

const NON_ISSUER_ABBREVIATIONS = new Set([
  "BCTC",
  "CTCP",
  "CFO",
  "CFI",
  "CFF",
  "OCF",
  "FCF",
  "FCFE",
  "FCFF",
  "PAT",
  "PBT",
  "NPAT",
  "NCI",
  "LNST",
  "LNTT",
  "EBIT",
  "EBITDA",
  "ROA",
  "ROE",
  "ROIC",
  "ROCE",
  "EPS",
  "DPS",
  "NAV",
  "VND",
  "USD",
  "EUR",
  "IFRS",
  "VAS",
  "YOY",
  "YTD",
  "TTM",
  "LTM",
  "CAGR",
  "DSO",
  "DIO",
  "DPO",
  "CCC",
  "WACC",
  "CAPEX",
  "OPEX",
  "FTEL",
  "VAT",
  "TNDN",
  "HNX",
  "HOSE",
  "UPCOM",
]);
const BANK_METRIC_ABBREVIATIONS = new Set(["NII", "NIM", "NPL", "CIR", "LDR", "PPOP"]);

function defaultScopeHint(value) {
  if (value === undefined) return {};
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["companyId", "periodId", "comparisonPeriodId"].includes(key),
    ) ||
    typeof value.companyId !== "string" ||
    Object.values(value).some((id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/u.test(id))
  ) {
    throw sourceError("invalid_default_scope");
  }
  return value;
}

function hasUnsupportedIssuerCue(query, normalized, companies, contextCompanyId) {
  // Supported issuer names are intentionally bounded. A displayed default
  // cannot turn an explicit unsupported ticker into a supported issuer request.
  const allowed = new Set(companies.flatMap((issuer) => [issuer.id, issuer.ticker]));
  if (
    (!allowed.has("HPG") && /\b(?:hpg|hoa phat)\b/u.test(normalized)) ||
    (!allowed.has("FPTS") && /\b(?:fpts|fpt securities|chung khoan fpt)\b/u.test(normalized))
  )
    return true;
  const coded = [
    ...query.matchAll(/(?<![\p{L}\p{N}_])([A-Z][A-Z0-9]{2,5})(?![\p{L}\p{N}_])/gu),
  ].map((match) => match[1]);
  const labelled = [
    ...query.matchAll(
      /(?:\bmã(?:\s+(?:cổ\s+phiếu|chứng\s+khoán))?|\bticker|\bstock\s+code)\s*[:=]?\s*([a-z][a-z0-9]{1,9})\b/giu,
    ),
  ].map((match) => match[1].toUpperCase());
  const bankContext = companies.some(
    (company) =>
      company.sectorId === "banking" &&
      (company.id === contextCompanyId ||
        [
          company.id.toLowerCase(),
          company.ticker.toLowerCase(),
          ...(Array.isArray(company.aliases)
            ? company.aliases.filter((alias) => typeof alias === "string")
            : []),
        ].some((alias) =>
          new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(
            normalized,
          ),
        )),
  );
  const unsupported = (code) =>
    !allowed.has(code) &&
    !NON_ISSUER_ABBREVIATIONS.has(code) &&
    !/^(?:FY20\d{2}|H[12]20\d{2}|Q[1-4]20\d{2})$/u.test(code);
  return (
    labelled.some(unsupported) ||
    coded.some((code) => unsupported(code) && !(bankContext && BANK_METRIC_ABBREVIATIONS.has(code)))
  );
}

export function resolveScopeFromDatasets(input = {}, datasets = getFrozenSecuritiesDatasets()) {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query.length > 2000) throw sourceError("query_too_long");
  const normalized = query
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const defaults = defaultScopeHint(input.defaultScope);
  const companies = issuersFromDatasets(datasets);
  if (hasUnsupportedIssuerCue(query, normalized, companies, input.companyId || defaults.companyId))
    throw sourceError("unsupported_company");
  const queryCompanyIds = companies
    .filter((company) =>
      [
        company.id.toLowerCase(),
        company.ticker.toLowerCase(),
        ...(Array.isArray(company.aliases)
          ? company.aliases.filter((alias) => typeof alias === "string")
          : []),
      ].some((alias) =>
        new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u").test(normalized),
      ),
    )
    .map((company) => company.id);
  const requestedCompanies = input.companyId
    ? companies.filter((company) => company.id === input.companyId)
    : [];
  if (input.companyId && !requestedCompanies.length)
    requestedCompanies.push(...companies.filter((company) => company.ticker === input.companyId));
  if (requestedCompanies.length > 1) throw sourceError("ambiguous_company");
  const explicitCompanyId = requestedCompanies[0]?.id ?? input.companyId;
  if (
    queryCompanyIds.length > 1 ||
    (explicitCompanyId && queryCompanyIds.length && explicitCompanyId !== queryCompanyIds[0])
  )
    throw sourceError("ambiguous_company");
  const companyId =
    explicitCompanyId || queryCompanyIds[0] || defaults.companyId || (!query ? "FPT" : null);
  if (!companyId) throw sourceError("unsupported_company");
  const choices = datasets.filter((dataset) => dataset.company.id === companyId);
  if (!choices.length) throw sourceError("unsupported_company");
  const requestedYears = [...normalized.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map((match) =>
    Number(match[1]),
  );
  if (
    /\bh2(?:[\s_-]*20\d{2})?\b|\b(?:second\s+half|nua\s+cuoi|6\s+thang\s+cuoi|9\s*(?:thang|months?)|3\s*(?:thang|months?))\b/.test(
      normalized,
    )
  )
    throw sourceError("unsupported_period");
  const explicitHalf = /\bh1[\s_-]*(20\d{2})\b/u.exec(normalized);
  const explicitAnnual = /\bfy[\s_-]*(20\d{2})\b/u.exec(normalized);
  const explicitQuarter = /\bq([1-4])[\s_-]*(20\d{2})\b/u.exec(normalized);
  const namedQuarter = /\b(?:q|quy\s*)([1-4])\b/u.exec(normalized);
  if ([explicitHalf, explicitAnnual, explicitQuarter].filter(Boolean).length > 1)
    throw sourceError("ambiguous_period");
  const halfRequested = explicitHalf || /\b(?:6 thang|ban nien|h1|half.year)\b/u.test(normalized);
  const annualRequested = explicitAnnual || /\b(?:ca nam|nam|fy|annual|year)\b/u.test(normalized);
  const latestRequested = /(?:moi nhat|latest|gan nhat)/u.test(normalized);
  const latestPeriod = [...choices].sort((a, b) => b.period.end.localeCompare(a.period.end))[0]
    .period.id;
  const latestHalf = choices
    .filter((dataset) => dataset.period.kind === "half_year")
    .sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.period.id;
  const latestAnnual = choices
    .filter((dataset) => dataset.period.kind === "annual")
    .sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.period.id;
  const latestQuarter = choices
    .filter(
      (dataset) =>
        dataset.period.kind === "quarter" &&
        (!namedQuarter || dataset.period.id.startsWith(`Q${namedQuarter[1]}_`)),
    )
    .sort((a, b) => b.period.end.localeCompare(a.period.end))[0]?.period.id;
  let inferred = null;
  if (explicitQuarter) inferred = `Q${explicitQuarter[1]}_${explicitQuarter[2]}`;
  else if (namedQuarter)
    inferred = requestedYears[0] ? `Q${namedQuarter[1]}_${requestedYears[0]}` : latestQuarter;
  else if (explicitHalf) inferred = `H1_${explicitHalf[1]}`;
  else if (explicitAnnual) inferred = `FY${explicitAnnual[1]}`;
  else if (halfRequested) inferred = requestedYears[0] ? `H1_${requestedYears[0]}` : latestHalf;
  else if (annualRequested) inferred = requestedYears[0] ? `FY${requestedYears[0]}` : latestAnnual;
  else if (latestRequested) inferred = latestPeriod;
  if (
    (namedQuarter && !inferred) ||
    (halfRequested && !inferred) ||
    (annualRequested && !halfRequested && !inferred)
  )
    throw sourceError("unsupported_period");
  if (input.periodId && inferred && input.periodId !== inferred)
    throw sourceError("ambiguous_period");
  const hintedPeriod =
    companyId === defaults.companyId && !latestRequested ? defaults.periodId : null;
  const periodId = input.periodId || inferred || hintedPeriod || latestPeriod;
  if (
    !inferred &&
    requestedYears.length &&
    !requestedYears.includes(Number(periodId.match(/20\d{2}/)?.[0]))
  )
    throw sourceError(input.periodId ? "ambiguous_period" : "unsupported_period");
  const periodChoices = choices.filter((dataset) => dataset.period.id === periodId);
  if (!periodChoices.length) throw sourceError("unsupported_period");
  const hintedComparison =
    companyId === defaults.companyId && periodId === defaults.periodId
      ? defaults.comparisonPeriodId
      : null;
  const comparisonId =
    input.comparisonPeriodId ||
    hintedComparison ||
    [...periodChoices].sort((a, b) => comparisonPriority(a) - comparisonPriority(b))[0]
      .comparisonPeriod.id;
  const selected = periodChoices.find((dataset) => dataset.comparisonPeriod.id === comparisonId);
  if (!selected) throw sourceError("unsupported_comparison");
  return {
    companyId,
    periodId,
    comparisonPeriodId: comparisonId,
    company: selected.company,
    period: selected.period,
    comparisonPeriod: selected.comparisonPeriod,
    comparisonBasis: selected.comparisonBasis,
    sources: selected.sources,
    freshness: selected.freshness,
    warnings: selected.issues,
    ready: true,
    latestRequested,
    query,
    scopeNotice: labels(
      "Phân tích đúng doanh nghiệp, kỳ và cơ sở nêu trên.",
      "Analysis is bound to the issuer, period and basis shown above.",
    ),
  };
}

export function resolveSecuritiesScope(input) {
  return resolveScopeFromDatasets(input);
}

export function loadFrozenSecuritiesDataset(scope) {
  const found = getFrozenSecuritiesDatasets().find(
    (dataset) =>
      dataset.company.id === scope.companyId &&
      dataset.period.id === scope.periodId &&
      dataset.comparisonPeriod.id === scope.comparisonPeriodId,
  );
  if (!found) throw sourceError("unsupported_scope");
  return structuredClone(found);
}
