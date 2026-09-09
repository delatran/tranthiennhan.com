import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMarketResearchProvider } from "../../scripts/securities/market-research.mjs";
import { startSecuritiesIngestionService } from "../../scripts/securities/ingestion-service.mjs";
import {
  marketDirectoryUnavailable,
  marketUnavailable,
} from "../../shared/securities/market-data.js";
import { handleSecuritiesRequest } from "../../worker/securities/api.js";
import {
  readSecuritiesMarketDirectory,
  readSecuritiesMarketResearch,
} from "../../worker/securities/ingestion.js";

// Synthetic providers only. HTTP stays on test-owned loopback servers.
const INPUT = { symbol: "FIX", exchange: "HOSE", locale: "en", query: "latest disclosure" };
const ENV = {
  SECURITIES_MODEL_MODE: "live",
  SECURITIES_OPENROUTER_API_KEY: "sk-or-synthetic_fixture_key_only",
};
const STOCK = {
  symbol: "FIX",
  exchange: "HOSE",
  name: "Synthetic issuer",
  securityType: "stock",
  status: "listed",
};
const TOKEN = "synthetic_research_fixture_token_only";
function directoryPacket() {
  return {
    ...marketDirectoryUnavailable(),
    status: "ready",
    error: undefined,
    items: [STOCK],
    coverage: ["HOSE", "HNX", "UPCOM"].map((exchange) => ({
      exchange,
      status: "complete",
      expectedCount: exchange === "HOSE" ? 1 : 0,
      receivedCount: exchange === "HOSE" ? 1 : 0,
    })),
  };
}
const market = {
  getDirectory: async () => directoryPacket(),
  get: async (input) => marketUnavailable(input),
};
function result(input = INPUT) {
  return {
    schemaVersion: 1,
    symbol: input.symbol,
    exchange: input.exchange,
    companyName: STOCK.name,
    status: "unavailable",
    fetchedAt: new Date().toISOString(),
    sources: [],
    limitations: [],
    evidenceStatus: "public_reading_unverified",
  };
}
async function temporary(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "market-research-test-"));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

const SOURCE_URL = "https://fixture-issuer.vn/company";
function publicSource() {
  return {
    schemaVersion: 1,
    url: SOURCE_URL,
    hash: "a".repeat(64),
    byteLength: 1234,
    fetchedAt: new Date().toISOString(),
    contentType: "text/html",
    text: "Synthetic issuer publishes its company introduction on this public page. This text is a fixture and contains no real financial information.",
    extraction: { method: "static_html", partial: false, pagesRead: null, totalPages: null },
  };
}

test("source text is persisted privately before delivery and omitted from the operation audit", async (t) => {
  const directory = await temporary(t);
  const source = publicSource();
  let reads = 0;
  const provider = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    readSource: async ({ url, domains, signal }) => {
      assert.equal(url, SOURCE_URL);
      assert.deepEqual(domains, ["fixture-issuer.vn"]);
      assert.equal(signal.aborted, false);
      reads++;
      return source;
    },
    research: async ({ readSource }) => {
      assert.deepEqual(
        await readSource({ url: SOURCE_URL, domains: ["fixture-issuer.vn"] }),
        source,
      );
      const files = await readdir(directory);
      const sourceFile = files.find((file) => file.endsWith(".source.json"));
      assert.ok(sourceFile);
      assert.deepEqual(
        JSON.parse(await readFile(path.join(directory, sourceFile), "utf8")),
        source,
      );
      const audit = JSON.parse(
        await readFile(
          path.join(
            directory,
            files.find((file) => !file.endsWith(".source.json")),
          ),
          "utf8",
        ),
      );
      assert.equal(audit.source.file, sourceFile);
      assert.equal(audit.source.hash, source.hash);
      assert.equal(audit.source.text, undefined);
      assert.equal(audit.status, "running");
      return result();
    },
  });
  t.after(() => provider.close());
  const delivered = await provider.get(INPUT);
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(delivered).includes(source.text), false);
});

test("invalid or unpersisted downloaded source cannot be delivered as a research result", async (t) => {
  for (const failure of ["identity", "storage"]) {
    const directory = await temporary(t);
    const provider = await createMarketResearchProvider({
      directory,
      marketProvider: market,
      env: ENV,
      readSource: async () => {
        if (failure === "storage") {
          const file = (await readdir(directory)).find((name) => name.endsWith(".json"));
          await mkdir(path.join(directory, file.replace(/\.json$/u, ".source.json")));
        }
        return failure === "identity"
          ? { ...publicSource(), url: "https://other-issuer.vn/company" }
          : publicSource();
      },
      research: async ({ readSource }) => {
        await readSource({ url: SOURCE_URL, domains: ["fixture-issuer.vn"] });
        return result();
      },
    });
    t.after(() => provider.close());
    await assert.rejects(provider.get(INPUT), {
      code:
        failure === "identity" ? "market_research_invalid_source" : "receipt_persistence_failed",
    });
    const file = (await readdir(directory)).find(
      (name) => name.endsWith(".json") && !name.endsWith(".source.json"),
    );
    const audit = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    assert.equal(audit.status, "failed");
    assert.equal(audit.result, undefined);
    assert.equal(audit.source, undefined);
    assert.equal(audit.sourceReads[0].status, "failed");
  }
});

test("fallback attempts and separately persisted source packets remain distinguishable in the audit", async (t) => {
  const directory = await temporary(t);
  const failed = `${SOURCE_URL}/failed`;
  const blank = `${SOURCE_URL}/blank`;
  const packets = [
    {
      ...publicSource(),
      url: blank,
      text: "",
      hash: "b".repeat(64),
      extraction: { method: "static_html", partial: true, pagesRead: null, totalPages: null },
    },
    publicSource(),
  ];
  const access = {
    requestedUrl: failed,
    resolvedUrl: failed,
    attempts: [{ url: failed, status: 404 }],
    redirects: [],
  };
  const provider = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    readSource: async ({ url }) => {
      if (url === failed)
        throw Object.assign(new Error("PRIVATE_SOURCE_FAILURE_TEXT"), {
          code: "source_fetch_failed",
          sourceAccess: access,
        });
      return packets.find((packet) => packet.url === url);
    },
    research: async ({ readSource }) => {
      const options = (url) => ({ url, domains: ["fixture-issuer.vn"] });
      await assert.rejects(readSource(options(failed)), { code: "source_fetch_failed" });
      for (const packet of packets) assert.deepEqual(await readSource(options(packet.url)), packet);
      return result();
    },
  });
  t.after(() => provider.close());
  await provider.get(INPUT);
  const files = await readdir(directory);
  const auditFile = files.find((file) => !file.includes(".source"));
  const auditText = await readFile(path.join(directory, auditFile), "utf8");
  const audit = JSON.parse(auditText);
  assert.deepEqual(
    audit.sourceReads.map(({ status }) => status),
    ["failed", "read", "read"],
  );
  assert.deepEqual(audit.sourceReads[0].access, access);
  assert.equal(audit.sourceReads[0].error.code, "source_fetch_failed");
  assert.equal(auditText.includes("PRIVATE_SOURCE_FAILURE_TEXT"), false);
  assert.equal(auditText.includes(packets[1].text), false);
  assert.equal(audit.sources.length, 2);
  assert.notEqual(audit.sources[0].file, audit.sources[1].file);
  assert.equal(audit.source.file, audit.sources[0].file);
  for (let index = 0; index < packets.length; index++)
    assert.deepEqual(
      JSON.parse(await readFile(path.join(directory, audit.sources[index].file), "utf8")),
      packets[index],
    );
});

test("cancellation during independent source reading releases admission without a late source write", async (t) => {
  const directory = await temporary(t);
  let started,
    release,
    shouldRead = true;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const provider = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    readSource: async () => {
      started();
      await delayed;
      return publicSource();
    },
    research: async ({ readSource }) => {
      if (shouldRead) await readSource({ url: SOURCE_URL, domains: ["fixture-issuer.vn"] });
      return result();
    },
  });
  t.after(() => provider.close());
  const controller = new AbortController();
  const pending = provider.get(INPUT, { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "market_cancelled" });
  await ready;
  controller.abort();
  await rejected;
  shouldRead = false;
  await provider.get(INPUT);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await readdir(directory)).some((file) => file.endsWith(".source.json")),
    false,
  );
});
test("research records attempts before delivery and caches only identical explicit requests", async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  let time = Date.now();
  const provider = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    now: () => time,
    research: async ({ input, onReceipt }) => {
      calls++;
      const audits = await Promise.all(
        (await readdir(directory))
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"))),
      );
      const audit = audits.find((entry) => entry.status === "running");
      assert.equal(audit.status, "running");
      assert.equal(audit.query, undefined);
      await onReceipt({ operation: "discovery", status: "succeeded", synthetic: true });
      return result(input);
    },
  });
  t.after(() => provider.close());
  assert.equal((await provider.get(INPUT)).cache.hit, false);
  assert.equal((await provider.get({ ...INPUT })).cache.hit, true);
  assert.equal(calls, 1);
  assert.equal((await provider.get({ ...INPUT, query: "different question" })).cache.hit, false);
  assert.equal(calls, 2);
  time += 300_001;
  await provider.get(INPUT);
  assert.equal(calls, 3);
  const auditFiles = await readdir(directory);
  assert.equal(auditFiles.length, 3);
  const audits = await Promise.all(
    auditFiles.map(async (file) => JSON.parse(await readFile(path.join(directory, file), "utf8"))),
  );
  assert.ok(audits.every((audit) => audit.status === "unavailable" && audit.receipts.length === 1));
});
test("AI-off, unknown stock and failed audit storage admit no model call", async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  const research = async () => {
    calls++;
    return result();
  };
  const off = await createMarketResearchProvider({ directory, marketProvider: market, research });
  await assert.rejects(off.get(INPUT), { code: "model_not_configured" });
  await off.close();
  const live = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    research,
  });
  await assert.rejects(live.get({ ...INPUT, symbol: "ZZZ" }), { code: "market_symbol_missing" });
  await live.close();
  assert.equal(calls, 0);
  const storage = path.join(directory, "audit");
  const broken = await createMarketResearchProvider({
    directory: storage,
    marketProvider: market,
    env: ENV,
    research,
  });
  await rmdir(storage);
  await writeFile(storage, "synthetic file blocks directory");
  await assert.rejects(broken.get(INPUT), { code: "receipt_persistence_failed" });
  await broken.close();
  assert.equal(calls, 0);
});
test("one active research request rejects duplicate spend and cancellation releases admission", async (t) => {
  const directory = await temporary(t);
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const provider = await createMarketResearchProvider({
    directory,
    marketProvider: market,
    env: ENV,
    research: async ({ signal }) => {
      started();
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const controller = new AbortController();
  const first = provider.get(INPUT, { signal: controller.signal });
  const rejected = assert.rejects(first, { code: "market_cancelled" });
  await ready;
  await assert.rejects(provider.get(INPUT), { code: "market_research_busy" });
  controller.abort();
  await rejected;
  await provider.close();
  const audit = JSON.parse(
    await readFile(path.join(directory, (await readdir(directory))[0]), "utf8"),
  );
  assert.equal(audit.status, "cancelled");
});
test("deadline cancels admitted research and never delivers or caches a late model result", async (t) => {
  for (const abortOutcome of ["reject", "late result"])
    await t.test(abortOutcome, async (t) => {
      const directory = await temporary(t);
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const admitted = Promise.withResolvers();
      let calls = 0,
        expire = true,
        modelSignal;
      const provider = await createMarketResearchProvider({
        directory,
        marketProvider: market,
        env: ENV,
        timeoutMs: 20,
        research: async ({ signal, onReceipt }) => {
          calls++;
          await onReceipt({ operation: "discovery", synthetic: true });
          signal.throwIfAborted();
          if (!expire) return result();
          modelSignal = signal;
          return new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => (abortOutcome === "reject" ? reject(signal.reason) : resolve(result())),
              { once: true },
            );
            admitted.resolve();
          });
        },
      });
      t.after(() => provider.close());
      const rejected = assert.rejects(provider.get(INPUT), { code: "market_research_timeout" });
      // Advance only after audit persistence, preflight, and the abort listener are ready.
      await admitted.promise;
      assert.equal(calls, 1);
      t.mock.timers.tick(19);
      assert.equal(modelSignal.aborted, false);
      t.mock.timers.tick(1);
      assert.equal(modelSignal.aborted, true);
      assert.equal(modelSignal.reason.name, "TimeoutError");
      await rejected;
      const audits = await Promise.all(
        (await readdir(directory)).map(async (file) =>
          JSON.parse(await readFile(path.join(directory, file), "utf8")),
        ),
      );
      assert.equal(audits.length, 1);
      assert.equal(audits[0].status, "failed");
      assert.equal(audits[0].error.code, "market_research_timeout");
      assert.equal(audits[0].receipts.length, 1);
      assert.equal(audits[0].result, undefined);
      expire = false;
      assert.equal((await provider.get(INPUT)).cache.hit, false);
      assert.equal(calls, 2);
    });
});

test("invalid profile identity cannot admit a model call", async (t) => {
  const directory = await temporary(t);
  let calls = 0;
  const mismatch = await createMarketResearchProvider({
    directory,
    marketProvider: {
      ...market,
      get: async (input) => marketUnavailable({ ...input, symbol: "BAD" }),
    },
    env: ENV,
    research: async () => {
      calls++;
      return result();
    },
  });
  await assert.rejects(mismatch.get(INPUT), { code: "market_invalid_response" });
  await mismatch.close();
  assert.equal(calls, 0);
});
for (const phase of ["directory", "profile"])
  test(`cancellation during ${phase} preflight releases admission without waiting for the shared market fetch`, async (t) => {
    const directory = await temporary(t);
    let started,
      release,
      calls = 0,
      blocked = true;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    const marketProvider = {
      getDirectory: async () => {
        if (blocked && phase === "directory") {
          started();
          await delayed;
        }
        return directoryPacket();
      },
      get: async (input) => {
        if (blocked && phase === "profile") {
          started();
          await delayed;
        }
        return marketUnavailable(input);
      },
    };
    const provider = await createMarketResearchProvider({
      directory,
      marketProvider,
      env: ENV,
      research: async () => {
        calls++;
        return result();
      },
    });
    t.after(() => provider.close());
    const controller = new AbortController();
    const pending = provider.get(INPUT, { signal: controller.signal });
    const rejected = assert.rejects(pending, { code: "market_cancelled" });
    await ready;
    controller.abort();
    await Promise.race([
      rejected,
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("cancelled preflight retained admission")),
          500,
        );
        timer.unref();
      }),
    ]);
    assert.equal(calls, 0);
    blocked = false;
    assert.equal((await provider.get(INPUT)).status, "unavailable");
    assert.equal(calls, 1);
    release();
    await provider.close();
  });
test("collector and Worker bridge enforce authentication, closed input and stock identity", async (t) => {
  const directory = await temporary(t);
  let researchCalls = 0;
  const service = await startSecuritiesIngestionService({
    token: TOKEN,
    directory,
    collect: async () => ({ datasets: [] }),
    readMarketDirectory: market.getDirectory,
    readMarketResearch: async (input) => {
      researchCalls++;
      return result(input);
    },
  });
  t.after(() => service.close());
  const env = {
    SECURITIES_LOCAL_MODE: "true",
    SECURITIES_INGESTION_TOKEN: TOKEN,
    SECURITIES_INGESTION_URL: service.url,
  };
  assert.equal((await fetch(`${service.url}/market/directory`)).status, 401);
  assert.equal(
    (
      await fetch(`${service.url}/market/directory`, {
        headers: { Authorization: `Bearer ${TOKEN}`, Origin: "http://localhost" },
      })
    ).status,
    403,
  );
  assert.equal((await readSecuritiesMarketDirectory({ env })).items.length, 1);
  assert.equal((await readSecuritiesMarketResearch(INPUT, { env })).symbol, "FIX");
  const invalid = await fetch(`${service.url}/market/research`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...INPUT, sourceDomains: ["evil.example"] }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(researchCalls, 1);
  const external = await readSecuritiesMarketDirectory({
    env: { ...env, SECURITIES_INGESTION_URL: "https://example.com/" },
  });
  assert.equal(external.status, "unavailable");
});
test("public API permits directory reads without AI and keeps research same-origin and opt-in", async () => {
  const env = { SECURITIES_LOCAL_MODE: "true", SECURITIES_DB: {}, SECURITIES_MODEL_MODE: "off" };
  const deps = {
    store: {},
    readMarketDirectory: market.getDirectory,
    readMarketResearch: async () => result(),
  };
  const response = await handleSecuritiesRequest(
    new Request("http://127.0.0.1/api/securities/market/directory"),
    env,
    {},
    deps,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.items.length, 1);
  assert.equal(
    (
      await handleSecuritiesRequest(
        new Request("http://127.0.0.1/api/securities/market/directory?source=x"),
        env,
        {},
        deps,
      )
    ).status,
    400,
  );
  const request = (origin = "http://127.0.0.1", extra = {}) =>
    new Request("http://127.0.0.1/api/securities/market/research", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...INPUT, ...extra }),
    });
  assert.equal((await handleSecuritiesRequest(request(), env, {}, deps)).status, 503);
  assert.equal(
    (await handleSecuritiesRequest(request("https://other.example"), { ...env, ...ENV }, {}, deps))
      .status,
    403,
  );
  assert.equal(
    (
      await handleSecuritiesRequest(
        request("http://127.0.0.1", { sourceDomains: ["evil.example"] }),
        { ...env, ...ENV },
        {},
        deps,
      )
    ).status,
    400,
  );
  assert.equal(
    (await handleSecuritiesRequest(request(), { ...env, ...ENV }, {}, deps)).status,
    200,
  );
});
