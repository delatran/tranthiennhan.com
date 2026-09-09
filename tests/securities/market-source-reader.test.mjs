import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import test from "node:test";
import { readMarketResearchSource } from "../../scripts/securities/market-source-reader.mjs";
import { SECURITIES_SOURCE_POLICY } from "../../shared/securities/source-contract.js";
import {
  nodeMarketResearchFetch,
  nodeSecuritiesFetch,
} from "../../scripts/securities/source-network.mjs";
import {
  validateMarketResearchSource,
  validateMarketResearchSourceAccess,
} from "../../worker/securities/market-research.js";

const URL = "https://issuer.example.com/disclosures/report";
const DOMAINS = ["issuer.example.com"];
const NOW = "2026-09-07T04:00:00.000Z";
const htmlResponse = (body, extra = {}) =>
  new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" }, ...extra });
const read = (body, extra = {}) =>
  readMarketResearchSource({
    url: URL,
    domains: DOMAINS,
    now: () => NOW,
    fetchImpl: async () => htmlResponse(body),
    ...extra,
  });

function pdf(pages = 1, passage = "Synthetic issuer source statement.", paddingBytes = 0) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let i = 0; i < pages; i++) {
    const content =
      passage === null ? "" : `BT /F1 12 Tf 72 720 Td (${passage} Page ${i + 1}.) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    );
  }
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\n`;
  if (paddingBytes) output += `%${" ".repeat(paddingBytes - 2)}\n`;
  output += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

test("static HTML excludes executable and template content, decodes entities, and binds original bytes", async () => {
  const original =
    '<!doctype html><html><head><title>Issuer</title><script>head secret</script></head><body><script>script secret</script><style>style secret</style><!-- comment secret --><template>template secret<template>nested secret</template>outer secret</template><noscript>fallback secret</noscript><p title="attribute > secret">SHS &#273;&#432;&#7907;c th&#224;nh l&#7853;p &amp; c&#244;ng b&#7889;.</p><p>Zero: 0 &lt; 1 &quot;quoted&quot; &nbsp; &#x1F4C4;</p></body></html>';
  const source = await read(original);
  assert.equal(source.hash, createHash("sha256").update(original).digest("hex"));
  assert.equal(source.byteLength, Buffer.byteLength(original));
  assert.equal(source.fetchedAt, NOW);
  assert.equal(source.text, 'SHS được thành lập & công bố. Zero: 0 < 1 "quoted" 📄');
  assert.equal(source.text.includes("secret"), false);
  assert.deepEqual(source.extraction, {
    method: "static_html",
    partial: false,
    pagesRead: null,
    totalPages: null,
  });
  assert.equal(validateMarketResearchSource(source, URL), source);
});

test("only exact canonical allowlisted URLs reach the fetcher", async () => {
  let calls = 0;
  for (const url of [
    URL + "#fragment",
    URL.replace("issuer.example.com", "attacker.test"),
    URL.replace("https:", "http:"),
    URL.replace("https://", "https://user:pass@"),
    URL.replace("issuer.example.com", "127.0.0.1"),
  ]) {
    await assert.rejects(
      read("<p>Fixture</p>", {
        url,
        fetchImpl: async () => {
          calls++;
          return htmlResponse("<p>Fixture</p>");
        },
      }),
    );
  }
  assert.equal(calls, 0);
});

test("redirects, unsupported MIME, partial responses and changed response URLs are rejected", async () => {
  for (const response of [
    new Response("", { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
    new Response("{}", { headers: { "Content-Type": "application/json" } }),
    htmlResponse("<p>Partial</p>", { status: 206 }),
  ]) {
    await assert.rejects(read("", { fetchImpl: async () => response }));
  }
  const moved = htmlResponse("<p>Moved</p>");
  Object.defineProperty(moved, "url", { value: "https://attacker.test/" });
  await assert.rejects(read("", { fetchImpl: async () => moved }), {
    code: "source_redirect_rejected",
  });
});

test("same-host and www canonical redirects retain original identity and record each anonymous hop", async () => {
  const next = "https://issuer.example.com/canonical";
  const final = "https://www.issuer.example.com/canonical";
  const urls = [];
  const html = "<p>Synthetic public issuer passage.</p>";
  const source = await read("", {
    fetchImpl: async (url, options) => {
      urls.push(url);
      assert.deepEqual(options.domains, [new globalThis.URL(url).hostname]);
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.headers, undefined);
      if (url === URL)
        return new Response(null, { status: 301, headers: { Location: "/canonical" } });
      if (url === next) return new Response(null, { status: 308, headers: { Location: final } });
      return htmlResponse(html);
    },
  });
  assert.deepEqual(urls, [URL, next, final]);
  assert.equal(source.url, URL);
  assert.equal(source.hash, createHash("sha256").update(html).digest("hex"));
  assert.deepEqual(source.access, {
    requestedUrl: URL,
    resolvedUrl: final,
    attempts: [
      { url: URL, status: 301 },
      { url: next, status: 308 },
      { url: final, status: 200 },
    ],
    redirects: [
      { from: URL, to: next, status: 301 },
      { from: next, to: final, status: 308 },
    ],
  });
  assert.equal(validateMarketResearchSource(source, URL), source);
});

test("redirects cannot change issuer, widen subdomains, downgrade HTTPS or reach private URLs", async () => {
  for (const location of [
    "https://other.example.com/report",
    "https://cdn.issuer.example.com/report",
    "https://example.com/report",
    "http://issuer.example.com/report",
    "https://127.0.0.1/private",
    "https://user:pass@issuer.example.com/report",
    "https://issuer.example.com/report%5cprivate",
  ]) {
    let calls = 0;
    await assert.rejects(
      read("", {
        fetchImpl: async () => {
          calls++;
          return new Response(null, { status: 302, headers: { Location: location } });
        },
      }),
      (error) => {
        assert.equal(error.code, "source_redirect_rejected");
        assert.equal(error.sourceAccess.redirects.length, 0);
        assert.equal(error.sourceAccess.resolvedUrl, URL);
        assert.equal(JSON.stringify(error.sourceAccess).includes(location), false);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("redirect loops and the shared redirect limit stop before another request", async () => {
  for (const mode of ["loop", "limit"]) {
    const urls = [];
    await assert.rejects(
      read("", {
        fetchImpl: async (url) => {
          urls.push(url);
          return new Response(null, {
            status: 301,
            headers: { Location: mode === "loop" ? URL : `/hop-${urls.length}` },
          });
        },
      }),
      (error) => {
        assert.equal(
          error.code,
          mode === "loop" ? "source_redirect_loop" : "source_redirect_limit",
        );
        assert.equal(error.sourceAccess.attempts.length, mode === "loop" ? 1 : 4);
        validateMarketResearchSourceAccess(error.sourceAccess, URL);
        return true;
      },
    );
    assert.equal(urls.length, mode === "loop" ? 1 : 4);
  }
});

test("access metadata rejects invented redirects, private targets, broken chains and false successful reads", async () => {
  const source = await read("<p>Fixture</p>");
  const invalid = [
    { ...source.access, resolvedUrl: "https://other.example.com/" },
    { ...source.access, attempts: [{ url: URL, status: 206 }] },
    { ...source.access, attempts: [] },
    { ...source.access, redirects: [{ from: URL, to: "https://127.0.0.1/", status: 301 }] },
    { ...source.access, attempts: [{ url: URL, status: 200, headers: {} }] },
  ];
  for (const access of invalid)
    assert.throws(() => validateMarketResearchSource({ ...source, access }, URL), {
      code: "market_research_invalid_source",
    });
  assert.throws(
    () =>
      validateMarketResearchSourceAccess(
        {
          requestedUrl: "http://127.0.0.1/",
          resolvedUrl: "http://127.0.0.1/",
          attempts: [],
          redirects: [],
        },
        "http://127.0.0.1/",
      ),
    { code: "market_research_invalid_source" },
  );
});

test("a canonical redirect rechecks DNS and rejects a private destination before its connection", async (t) => {
  const hosts = [];
  let connects = 0;
  t.mock.method(dns, "lookup", async (host) => {
    hosts.push(host);
    return hosts.length === 1
      ? [{ address: "8.8.8.8", family: 4 }]
      : [
          { address: "8.8.8.8", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ];
  });
  t.mock.method(https, "request", (url, options, callback) => {
    connects++;
    assert.equal(url.href, URL);
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([]);
      Object.assign(response, {
        headers: { location: "https://www.issuer.example.com/canonical" },
        statusCode: 301,
        statusMessage: "Moved Permanently",
      });
      callback(response);
    };
    return request;
  });
  await assert.rejects(read("", { fetchImpl: nodeMarketResearchFetch }), (error) => {
    assert.equal(error.code, "private_source_address");
    assert.deepEqual(
      error.sourceAccess.attempts.map(({ status }) => status),
      [301, null],
    );
    return true;
  });
  assert.deepEqual(hosts, ["issuer.example.com", "www.issuer.example.com"]);
  assert.equal(connects, 1);
});

test("challenge and login pages cannot become independent source evidence", async () => {
  for (const body of [
    "<html><title>Just a moment</title><body>Checking your browser. Verify you are human.</body></html>",
    "<html><title>Đăng nhập</title><body><input type=password>Đăng nhập</body></html>",
    "<html><title>404 Not Found</title><body>Page not found</body></html>",
  ]) {
    await assert.rejects(read(body), (error) =>
      ["source_access_challenge", "source_login_required"].includes(error.code),
    );
  }
});

test("HTML body and decoded text limits preserve truthful truncation", async () => {
  await assert.rejects(read("<p>" + "x".repeat(2 * 1024 * 1024) + "</p>"), {
    code: "source_too_large",
  });
  const source = await read("<html><body>" + "x".repeat(250_001) + "</body></html>");
  assert.equal(source.text.length, 250_000);
  assert.equal(source.extraction.partial, true);
  await assert.rejects(
    read("", {
      fetchImpl: async () =>
        new Response("<p>short</p>", {
          headers: { "Content-Type": "text/html", "Content-Length": "500" },
        }),
    }),
    { code: "source_partial_content" },
  );
});

test("parent cancellation bounds a non-cooperative transport and closes a streaming body", async () => {
  const controller = new AbortController();
  const pending = read("", {
    signal: controller.signal,
    fetchImpl: async () => new Promise(() => {}),
  });
  controller.abort();
  await assert.rejects(pending, { code: "source_cancelled" });
  const streaming = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({
    start(control) {
      control.enqueue(new TextEncoder().encode("<html>"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const second = read("", {
    signal: streaming.signal,
    fetchImpl: async () => new Response(body, { headers: { "Content-Type": "text/html" } }),
  });
  setTimeout(() => streaming.abort(), 10);
  await assert.rejects(second, { code: "source_cancelled" });
  assert.equal(cancelled, true);
});

test("the shared read deadline ends a transport that ignores its abort signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = read("", { fetchImpl: async () => new Promise(() => {}) });
  t.mock.timers.tick(20_000);
  await assert.rejects(pending, { code: "source_timeout" });
});

test("canonical redirects share the original deadline instead of starting another timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const secondStarted = Promise.withResolvers();
  let calls = 0;
  const pending = read("", {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        t.mock.timers.tick(19_000);
        return new Response(null, { status: 301, headers: { Location: "/canonical" } });
      }
      secondStarted.resolve();
      return new Promise(() => {});
    },
  });
  const rejected = assert.rejects(pending, (error) => {
    assert.equal(error.code, "source_timeout");
    assert.deepEqual(
      error.sourceAccess.attempts.map(({ status }) => status),
      [301, null],
    );
    return true;
  });
  await secondStarted.promise;
  t.mock.timers.tick(1_000);
  await rejected;
  assert.equal(calls, 2);
});

test("a rejected response cannot delay failure with a non-cooperative body cancellation", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    read("", {
      fetchImpl: async () =>
        new Response(body, { headers: { "Content-Type": "application/json" } }),
    }),
    { code: "source_invalid_type" },
  );
  assert.equal(cancelled, true);
});

test("PDF text extraction reads bounded pages without OCR and marks a longer original partial", async () => {
  for (const pages of [1, 21]) {
    const bytes = pdf(pages);
    const source = await read("", {
      fetchImpl: async () =>
        new Response(bytes, { headers: { "Content-Type": "application/pdf" } }),
    });
    assert.equal(source.hash, createHash("sha256").update(bytes).digest("hex"));
    assert.ok(source.text.includes("Synthetic issuer source statement."));
    assert.deepEqual(source.extraction, {
      method: "pdf_text",
      partial: pages > 20,
      pagesRead: Math.min(20, pages),
      totalPages: pages,
    });
    assert.equal(validateMarketResearchSource(source, URL), source);
  }
});

test("the shared PDF byte policy accepts complete originals above 8 MiB and at its exact limit", async () => {
  for (const [size, declared] of [
    [8 * 1024 * 1024 + 1, true],
    [SECURITIES_SOURCE_POLICY.maxBytes, false],
  ]) {
    const bytes = pdf(1, undefined, size - pdf().byteLength);
    assert.equal(bytes.byteLength, size);
    const source = await read("", {
      fetchImpl: async () =>
        new Response(bytes, {
          headers: {
            "Content-Type": "application/pdf",
            ...(declared ? { "Content-Length": String(size) } : {}),
          },
        }),
    });
    assert.equal(source.byteLength, size);
    assert.equal(source.hash, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(source.text, "Synthetic issuer source statement. Page 1.");
    assert.deepEqual(source.extraction, {
      method: "pdf_text",
      partial: false,
      pagesRead: 1,
      totalPages: 1,
    });
    assert.equal(validateMarketResearchSource(source, URL), source);
  }
});

test("the shared PDF byte policy rejects declared and streamed overflow before parsing", async () => {
  for (const declared of [true, false]) {
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream(
      {
        pull(controller) {
          pulls++;
          if (pulls === 1) controller.enqueue(Buffer.alloc(SECURITIES_SOURCE_POLICY.maxBytes));
          else if (pulls === 2) controller.enqueue(Buffer.alloc(1));
          else controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    await assert.rejects(
      read("", {
        fetchImpl: async () =>
          new Response(body, {
            headers: {
              "Content-Type": "application/pdf",
              ...(declared
                ? { "Content-Length": String(SECURITIES_SOURCE_POLICY.maxBytes + 1) }
                : {}),
            },
          }),
      }),
      { code: "source_too_large" },
    );
    assert.equal(pulls, declared ? 0 : 2);
    assert.equal(cancelled, true);
  }
});

test("PDF page limits and wrong magic are rejected", async () => {
  for (const [bytes, expected] of [
    [pdf(301), "source_page_limit"],
    [Buffer.from("not a PDF"), "source_invalid_content"],
  ]) {
    await assert.rejects(
      read("", {
        fetchImpl: async () =>
          new Response(bytes, { headers: { "Content-Type": "application/pdf" } }),
      }),
      { code: expected },
    );
  }
});

test("a blank PDF stays an explicitly partial text extraction without OCR", async () => {
  const source = await read("", {
    fetchImpl: async () =>
      new Response(pdf(1, null), { headers: { "Content-Type": "application/pdf" } }),
  });
  assert.equal(source.text, "");
  assert.deepEqual(source.extraction, {
    method: "pdf_text",
    partial: true,
    pagesRead: 1,
    totalPages: 1,
  });
  assert.equal(validateMarketResearchSource(source, URL), source);
});

test("cancellation during PDF parsing stops the owned parser worker", async () => {
  const controller = new AbortController();
  const pending = read("", {
    signal: controller.signal,
    fetchImpl: async () =>
      new Response(pdf(20), { headers: { "Content-Type": "application/pdf" } }),
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { code: "source_cancelled" });
});

test("dynamic network wrapper rejects mixed private DNS and cannot accept auth headers", async (t) => {
  t.mock.method(dns, "lookup", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  t.mock.method(https, "request", () => assert.fail("private answer set must not connect"));
  await assert.rejects(nodeMarketResearchFetch(URL, { domains: DOMAINS }), {
    code: "private_source_address",
  });
  for (const headers of [
    { Authorization: "synthetic" },
    { Cookie: "synthetic=value" },
    { "User-Agent": "caller-controlled" },
  ]) {
    await assert.rejects(nodeMarketResearchFetch(URL, { domains: DOMAINS, headers }), {
      code: "unsupported_fetch_options",
    });
  }
  await assert.rejects(nodeSecuritiesFetch(URL));
});

test("dynamic network wrapper pins the validated DNS address and supplies only anonymous headers", async (t) => {
  let lookups = 0;
  t.mock.method(dns, "lookup", async () => {
    lookups++;
    return [{ address: "8.8.8.8", family: 4 }];
  });
  t.mock.method(https, "request", (url, options, callback) => {
    assert.equal(url.href, URL);
    assert.equal(options.agent, false);
    assert.equal(options.servername, "issuer.example.com");
    assert.deepEqual(options.headers, {
      Accept: "text/html, application/pdf;q=0.9",
      "Accept-Encoding": "identity",
      "User-Agent": "Nhan-for-Securities/1.0",
    });
    options.lookup("ignored.test", {}, (error, address, family) => {
      assert.equal(error, null);
      assert.equal(address, "8.8.8.8");
      assert.equal(family, 4);
    });
    const request = new EventEmitter();
    request.end = () => {
      const response = Readable.from([Buffer.from("<p>Fixture</p>")]);
      Object.assign(response, {
        headers: { "content-type": "text/html" },
        statusCode: 200,
        statusMessage: "OK",
      });
      callback(response);
    };
    return request;
  });
  assert.equal(
    await (await nodeMarketResearchFetch(URL, { domains: DOMAINS })).text(),
    "<p>Fixture</p>",
  );
  assert.equal(lookups, 1);
});
