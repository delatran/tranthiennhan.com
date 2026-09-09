import { createHash } from "node:crypto";

// The file digest identifies the original reviewed artifact. The content digest
// also permits recollection with a new timestamp, without trusting changed text,
// OCR output, coordinates, page order, parser identity or source bytes.
export const SECURITIES_EXTRACTION_PINS = Object.freeze({
  "fpt-h1-2026": Object.freeze({
    fileSha256: "ac4a0044c429371fdea4f4a3b828da922043b7abf99c1eebdbeb5bef4f04cfbc",
    contentSha256: "0b6142ef74fea3c322b67570c5f2b7e32f55167aaf3ab7d2457042c421e79306",
  }),
  "fpt-annual-2025": Object.freeze({
    fileSha256: "3feeeba86d2a8d1d4fe067817eebe11b8be986cf5b03c2603706dd102a035a6f",
    contentSha256: "4e1f49b1b19513bca79dbdbbe538ccad37af56a1e63e20e3a43cd9321eacf1e9",
  }),
  "gmd-h1-2026": Object.freeze({
    fileSha256: "0c285a9c3a38db41deda9c1fc095aec070b62b4383762f9898b3a6efab9af152",
    contentSha256: "6411a1974182d320bbae8cb5ff2c860ec2be01af9aaf25ad6cacab5a94d010b1",
  }),
  "vsc-h1-2026": Object.freeze({
    fileSha256: "3d7569218e29a2699230eafc29cfde41ebd0af2a28b84a9430157ba9fc132043",
    contentSha256: "2e5c0f86ca6b2cc19761df2139810034b08ea91aaf96ba75bedff824097e3db0",
  }),
  "acb-h1-2026": Object.freeze({
    fileSha256: "1349b4aeba08c8f17a7a60b72817763b377da43c977b9389e168bf2f1ba609cb",
    contentSha256: "48fd5fc3c07226f2d9ea89e2db94b63010541ad7dd4fed22db8ce318ac58036a",
  }),
});

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  }
  return value;
}

export function securitiesExtractionContentSha256(extraction) {
  const { extractedAt: collectionTimestamp, ...content } = extraction;
  return createHash("sha256")
    .update(JSON.stringify(ordered(content)))
    .digest("hex");
}
