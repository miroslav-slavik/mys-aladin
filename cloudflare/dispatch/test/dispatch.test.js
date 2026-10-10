import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FILES_PER_RUN,
  MAX_ATTEMPTS,
  expectedRuns,
  parseIndex,
  runId,
  shouldPoll,
  tick,
} from "../src/index.js";

const ENV = {
  SITE_URL: "https://site.test/mys-aladin",
  SOURCE_URL: "https://chmi.test/CZ_1km",
  GITHUB_REPO: "owner/repo",
  GITHUB_WORKFLOW: "forecast.yml",
  GITHUB_REF: "main",
  GITHUB_TOKEN: "token",
};

const PARTS = Array.from({ length: FILES_PER_RUN }, (_, i) => `PART${String(i).padStart(2, "0")}`);

const at = (iso) => Date.parse(iso);

function indexHtml(stamp, parts = PARTS) {
  // Like nginx: every file name appears twice, in the link and in its text.
  const rows = parts
    .map((part) => {
      const name = `ALADCZ1K4opendata_${stamp}_${part}.grb.bz2`;
      return `<a href="${name}">${name}</a> 28-Sep-2026 03:30 12345\n`;
    })
    .join("");
  return `<html><body><pre>${rows}</pre></body></html>`;
}

class MemoryKV {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)]));
    this.puts = [];
  }
  async get(key, type) {
    assert.equal(type, "json");
    const value = this.entries.get(key);
    return value === undefined ? null : JSON.parse(value);
  }
  async put(key, value, options) {
    this.puts.push({ key, value: JSON.parse(value), options });
    this.entries.set(key, value);
  }
}

/**
 * A fetch that answers from a table: the site's run, directory listings by
 * hour, and the status GitHub returns for a dispatch. Every call is kept.
 */
function fakeFetch({ site = "2026-09-27T18:00Z", listings = {}, dispatchStatus = 204 } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.startsWith(`${ENV.SITE_URL}/data/forecast.json`)) {
      if (site === null) return new Response("down", { status: 503 });
      return Response.json({ run_id: site });
    }
    if (url.startsWith(ENV.SOURCE_URL)) {
      const directory = url.slice(ENV.SOURCE_URL.length + 1, -1);
      return new Response(listings[directory] ?? indexHtml("0000000000", []));
    }
    if (url.startsWith("https://api.github.com/")) {
      return new Response(dispatchStatus === 204 ? null : "denied", { status: dispatchStatus });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  fetcher.calls = calls;
  fetcher.to = (prefix) => calls.filter((call) => call.url.startsWith(prefix));
  return fetcher;
}

test("runId matches the format of forecast.json", () => {
  assert.equal(runId(at("2026-09-28T06:00:00Z")), "2026-09-28T06:00Z");
  assert.equal(at("2026-09-28T06:00Z"), at("2026-09-28T06:00:00Z"));
});

test("parseIndex counts each file once and keeps runs apart", () => {
  const html = indexHtml("2026092700") + indexHtml("2026092800", PARTS.slice(0, 5));
  const runs = parseIndex(html + '<a href="Popis_obsahu.xlsx">x</a>');

  assert.deepEqual(
    runs.sort((a, b) => a.time - b.time),
    [
      { time: at("2026-09-27T00:00Z"), files: FILES_PER_RUN },
      { time: at("2026-09-28T00:00Z"), files: 5 },
    ],
  );
});

test("expectedRuns waits for the earliest publication time", () => {
  const published = at("2026-09-27T18:00Z");

  assert.deepEqual(expectedRuns(published, at("2026-09-28T02:59Z")), []);
  assert.deepEqual(expectedRuns(published, at("2026-09-28T03:00Z")), [at("2026-09-28T00:00Z")]);
  assert.deepEqual(expectedRuns(published, at("2026-09-28T09:10Z")), [
    at("2026-09-28T00:00Z"),
    at("2026-09-28T06:00Z"),
  ]);
});

test("shouldPoll slows to hourly three hours into polling", () => {
  const run = at("2026-09-28T00:00Z");

  assert.ok(shouldPoll(run, at("2026-09-28T05:50Z")));
  assert.ok(!shouldPoll(run, at("2026-09-28T06:20Z")));
  assert.ok(shouldPoll(run, at("2026-09-28T07:00Z")));
});

test("before the next run is due, CHMI is not asked", async () => {
  const fetcher = fakeFetch();
  const env = { ...ENV, STATE: new MemoryKV() };

  const outcome = await tick({ env, now: at("2026-09-28T02:50Z"), fetcher });

  assert.equal(outcome.action, "idle");
  assert.equal(fetcher.to(ENV.SOURCE_URL).length, 0);
});

test("the site is read past its cache", async () => {
  const fetcher = fakeFetch();
  const now = at("2026-09-28T02:50Z");

  await tick({ env: { ...ENV, STATE: new MemoryKV() }, now, fetcher });

  assert.equal(fetcher.calls[0].url, `${ENV.SITE_URL}/data/forecast.json?t=${now}`);
});

test("a run still landing is waited for, listing only its directory", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800", PARTS.slice(1)) } });
  const env = { ...ENV, STATE: new MemoryKV() };

  const outcome = await tick({ env, now: at("2026-09-28T03:20Z"), fetcher });

  assert.equal(outcome.action, "wait");
  assert.match(outcome.reason, /30\/31/);
  assert.deepEqual(
    fetcher.to(ENV.SOURCE_URL).map((call) => call.url),
    [`${ENV.SOURCE_URL}/00/`],
  );
  assert.equal(fetcher.to("https://api.github.com/").length, 0);
});

test("a complete run is dispatched once and recorded", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800") } });
  const state = new MemoryKV();
  const now = at("2026-09-28T03:40Z");

  const outcome = await tick({ env: { ...ENV, STATE: state }, now, fetcher });

  assert.equal(outcome.action, "dispatch");
  assert.equal(outcome.run, "2026-09-28T00:00Z");
  const [call] = fetcher.to("https://api.github.com/");
  assert.equal(call.url, "https://api.github.com/repos/owner/repo/actions/workflows/forecast.yml/dispatches");
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers.Authorization, "Bearer token");
  assert.ok(call.init.headers["User-Agent"]);
  assert.deepEqual(JSON.parse(call.init.body), { ref: "main" });
  assert.deepEqual(state.puts, [
    {
      key: "dispatch:2026-09-28T00:00Z",
      value: { attempts: 1, last: now },
      options: { expirationTtl: 3 * 24 * 60 * 60 },
    },
  ]);
});

test("while the site catches up, the run is not dispatched again", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800") } });
  const state = new MemoryKV({
    "dispatch:2026-09-28T00:00Z": { attempts: 1, last: at("2026-09-28T03:40Z") },
  });

  const outcome = await tick({ env: { ...ENV, STATE: state }, now: at("2026-09-28T04:00Z"), fetcher });

  assert.equal(outcome.action, "wait");
  assert.equal(fetcher.to("https://api.github.com/").length, 0);
});

test("after RETRY_AFTER the run is dispatched again", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800") } });
  const state = new MemoryKV({
    "dispatch:2026-09-28T00:00Z": { attempts: 1, last: at("2026-09-28T03:40Z") },
  });

  const outcome = await tick({ env: { ...ENV, STATE: state }, now: at("2026-09-28T04:10Z"), fetcher });

  assert.equal(outcome.action, "dispatch");
  assert.equal(state.puts[0].value.attempts, 2);
});

test("after MAX_ATTEMPTS the run is left to the fallback cron", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800") } });
  const state = new MemoryKV({
    "dispatch:2026-09-28T00:00Z": { attempts: MAX_ATTEMPTS, last: at("2026-09-28T04:40Z") },
  });

  const outcome = await tick({ env: { ...ENV, STATE: state }, now: at("2026-09-28T06:00Z"), fetcher });

  assert.equal(outcome.action, "exhausted");
  assert.equal(fetcher.to("https://api.github.com/").length, 0);
});

test("a refused dispatch is reported and not counted", async () => {
  const fetcher = fakeFetch({ listings: { "00": indexHtml("2026092800") }, dispatchStatus: 401 });
  const state = new MemoryKV();

  const outcome = await tick({ env: { ...ENV, STATE: state }, now: at("2026-09-28T03:40Z"), fetcher });

  assert.equal(outcome.action, "error");
  assert.match(outcome.reason, /401/);
  assert.equal(state.puts.length, 0);
});

test("an unreachable site stops the tick before CHMI", async () => {
  const fetcher = fakeFetch({ site: null });

  const outcome = await tick({ env: { ...ENV, STATE: new MemoryKV() }, now: at("2026-09-28T03:40Z"), fetcher });

  assert.equal(outcome.action, "error");
  assert.equal(fetcher.to(ENV.SOURCE_URL).length, 0);
});

test("a skipped run does not block the next one", async () => {
  // 00 UTC never appeared; 06 UTC is complete.
  const fetcher = fakeFetch({ listings: { "06": indexHtml("2026092806") } });
  const state = new MemoryKV();

  const outcome = await tick({ env: { ...ENV, STATE: state }, now: at("2026-09-28T10:40Z"), fetcher });

  assert.equal(outcome.action, "dispatch");
  assert.equal(outcome.run, "2026-09-28T06:00Z");
  assert.deepEqual(
    fetcher.to(ENV.SOURCE_URL).map((call) => call.url).sort(),
    [`${ENV.SOURCE_URL}/00/`, `${ENV.SOURCE_URL}/06/`],
  );
});

test("an old run already on the server is not taken for a new one", async () => {
  // Directory 00 still holds yesterday's complete run next to today's partial.
  const listing = indexHtml("2026092700") + indexHtml("2026092800", PARTS.slice(0, 3));
  const fetcher = fakeFetch({ listings: { "00": listing } });

  const outcome = await tick({ env: { ...ENV, STATE: new MemoryKV() }, now: at("2026-09-28T03:30Z"), fetcher });

  assert.equal(outcome.action, "wait");
  assert.match(outcome.reason, /3\/31/);
});

test("a long overdue run is checked only once an hour", async () => {
  const fetcher = fakeFetch();

  // Polling for 00 UTC started at 03:00; at 06:20 it is past FAST_POLLING.
  const outcome = await tick({ env: { ...ENV, STATE: new MemoryKV() }, now: at("2026-09-28T06:20Z"), fetcher });

  assert.equal(outcome.action, "idle");
  assert.equal(fetcher.to(ENV.SOURCE_URL).length, 0);
});
