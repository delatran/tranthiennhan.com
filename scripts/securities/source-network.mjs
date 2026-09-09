import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  sourceError,
  validateSecuritiesSourceUrl,
} from "../../shared/securities/source-contract.js";
import { publicResearchUrl } from "../../worker/securities/market-research.js";

export function isPublicSourceAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) ||
      (a === 203 && b === 0)
    );
  }
  if (isIP(address) === 6) {
    const ip = new URL(`http://[${address}]`).hostname.slice(1, -1).toLowerCase();
    const words = ip.split(":");
    const first = parseInt(words[0], 16);
    const second = parseInt(words[1] || "0", 16);
    // Conservative unicast policy excludes special-purpose, documentation and transition ranges.
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
      first !== 0x2002 &&
      !(first === 0x3fff && second <= 0xfff)
    );
  }
  return false;
}

/** Resolve once, reject the entire answer set if private, then pin that address in TLS lookup. */
export async function nodeSecuritiesFetch(input, { signal, headers = {}, method = "GET" } = {}) {
  const url = new URL(validateSecuritiesSourceUrl(input));
  return pinnedSourceFetch(url, { signal, headers, method });
}

/** Dynamic domains are supplied by the server's resolved issuer context. */
export async function nodeMarketResearchFetch(
  input,
  { domains, signal, method = "GET", redirect = "manual", credentials = "omit", ...extra } = {},
) {
  const canonical = publicResearchUrl(input, domains);
  if (canonical !== input) throw sourceError("unsafe_source_url");
  if (Object.keys(extra).length || redirect !== "manual" || credentials !== "omit")
    throw sourceError("unsupported_fetch_options");
  return pinnedSourceFetch(new URL(canonical), {
    signal,
    method,
    headers: {
      Accept: "text/html, application/pdf;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "Nhan-for-Securities/1.0",
    },
  });
}

async function pinnedSourceFetch(url, { signal, headers, method }) {
  if (method !== "GET") throw sourceError("unsupported_fetch_method");
  signal?.throwIfAborted();
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  signal?.throwIfAborted();
  if (!records.length || records.some((record) => !isPublicSourceAddress(record.address)))
    throw sourceError("private_source_address");
  const selected = records.find((record) => record.family === 4) || records[0];
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers,
        signal,
        agent: false,
        servername: url.hostname,
        lookup: (_hostname, lookupOptions, callback) =>
          lookupOptions.all
            ? callback(null, [selected])
            : callback(null, selected.address, selected.family),
      },
      (response) => {
        try {
          const responseHeaders = new Headers();
          for (const [name, values] of Object.entries(response.headers)) {
            if (Array.isArray(values))
              values.forEach((value) => responseHeaders.append(name, value));
            else if (values !== undefined) responseHeaders.set(name, String(values));
          }
          const body = [204, 205, 304].includes(response.statusCode)
            ? null
            : Readable.toWeb(response);
          if (body === null) response.resume();
          resolve(
            new Response(body, {
              status: response.statusCode,
              statusText: response.statusMessage,
              headers: responseHeaders,
            }),
          );
        } catch (error) {
          response.destroy();
          reject(error);
        }
      },
    );
    request.on("error", reject);
    request.end();
  });
}
