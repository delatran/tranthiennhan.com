import { securitiesReceiptIdentity } from "../../shared/securities/receipt-identity.js";

/** Summarize observed request costs without treating an unknown cost as zero. */
export function summarizeSecuritiesLiveCosts(results) {
  const requests = [];
  const identities = new Map();
  for (const receipt of results.flatMap((result) => result.receipts ?? [])) {
    const identity = securitiesReceiptIdentity(receipt);
    const cost = receipt.costUsd;
    const costUsd = typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
    const existing = identity === null ? undefined : identities.get(identity);
    if (existing === undefined) {
      const entry = { costUsd };
      if (identity !== null) identities.set(identity, entry);
      requests.push(entry);
    } else if (costUsd !== null) {
      if (existing.costUsd !== null && existing.costUsd !== costUsd)
        throw new Error("Conflicting receipt copies for costUsd.");
      existing.costUsd = costUsd;
    }
  }
  const known = requests.map((entry) => entry.costUsd).filter((cost) => cost !== null);
  const knownCostUsd = known.reduce((total, cost) => total + cost, 0);
  const unknownCostRequests = requests.length - known.length;
  return {
    knownCostUsd,
    unknownCostRequests,
    totalCostUsd: unknownCostRequests ? null : knownCostUsd,
    requestCount: requests.length,
  };
}
