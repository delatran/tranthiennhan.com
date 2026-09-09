/** Stable format identity for structured analyst reports. Source revisions and
 * implementation hashes provide provenance independently of this format name. */
export const SECURITIES_REPORT_CONTRACT = "securities-analyst-report";

const readableContracts = new Set([
  SECURITIES_REPORT_CONTRACT,
  // Existing immutable dossiers retain their original format identifier.
  "securities-report-v2",
]);

export function hasStructuredSecuritiesReport(analysis) {
  return readableContracts.has(analysis?.reportVersion);
}
