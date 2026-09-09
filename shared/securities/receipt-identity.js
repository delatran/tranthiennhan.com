/** Identify repeated observations without inventing an identity for anonymous receipts. */
export function securitiesReceiptIdentity(receipt) {
  if (typeof receipt?.transportAttemptId === "string" && receipt.transportAttemptId.trim())
    return JSON.stringify(["transport", receipt.transportAttemptId]);
  if (typeof receipt?.requestId === "string" && receipt.requestId.trim())
    return JSON.stringify([
      "provider",
      receipt.requestId,
      receipt.provider ?? null,
      receipt.startedAt ?? null,
    ]);
  return null;
}
