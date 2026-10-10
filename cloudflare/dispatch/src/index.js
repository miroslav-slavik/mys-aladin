// Starts the forecast workflow as soon as a new ALADIN run is complete.
//
// Scheduled runs in GitHub Actions are best-effort: they arrive one to two
// hours late and some are dropped, so a model run used to reach the site three
// to six hours after it was published. This Worker wakes every ten minutes,
// compares the run the site shows with what CHMI lists, and dispatches the
// workflow only when a newer complete run is waiting. The cron in the workflow
// stays in place as a fallback.
//
// State kept in KV exists for one reason: a workflow that keeps failing must
// not be restarted every ten minutes, since each attempt may download the
// whole run from CHMI. Hence at most MAX_ATTEMPTS per model run, RETRY_AFTER
// apart.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Hours between model runs; runs start at 00, 06, 12 and 18 UTC. */
export const RUN_STEP = 6 * HOUR;

/** A complete run publishes this many files; mirrors pipeline/config.py. */
export const FILES_PER_RUN = 31;

/** Same pattern as FILE_RE in pipeline/source.py. */
const FILE_RE = /ALADCZ1K4opendata_(\d{10})_([A-Z0-9_]+)\.grb\.bz2/g;

/**
 * Polling for a run starts this long after its nominal time. Publication was
 * measured at 3.5 h for the 00 and 12 runs and 4.5 h for the 06 and 18 runs.
 */
export const EARLIEST_PUBLICATION = 3 * HOUR;

/** Past this much time after polling started, check only once an hour. */
export const FAST_POLLING = 3 * HOUR;

export const MAX_ATTEMPTS = 3;

/**
 * Long enough for a dispatched run to finish, for the pages deploy that
 * follows it, and for the ten-minute cache of GitHub Pages to expire.
 */
export const RETRY_AFTER = 30 * MINUTE;

/** KV records outlive any run the server still holds. */
const RECORD_TTL_SECONDS = 3 * 24 * 60 * 60;

const USER_AGENT =
  "mys-aladin-dispatch/1.0 (personal forecast; https://github.com/miroslav-slavik/mys-aladin)";

/** "2026-09-28T00:00Z" for a timestamp in milliseconds. */
export function runId(time) {
  return new Date(time).toISOString().slice(0, 16) + "Z";
}

/** Runs listed in one CHMI directory index, as {time, files}. */
export function parseIndex(html) {
  const byStamp = new Map();
  for (const [, stamp, part] of html.matchAll(FILE_RE)) {
    if (!byStamp.has(stamp)) byStamp.set(stamp, new Set());
    byStamp.get(stamp).add(part);
  }
  return [...byStamp].map(([stamp, parts]) => ({
    time: Date.UTC(
      Number(stamp.slice(0, 4)),
      Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)),
      Number(stamp.slice(8, 10)),
    ),
    files: parts.size,
  }));
}

/**
 * Runs after the published one that CHMI may have released by now, oldest
 * first. Normally one; more only when a run was skipped or processing stalled.
 */
export function expectedRuns(published, now) {
  const runs = [];
  for (let time = published + RUN_STEP; time + EARLIEST_PUBLICATION <= now; time += RUN_STEP) {
    runs.push(time);
  }
  return runs;
}

/** True when this tick should look at CHMI, given the newest expected run. */
export function shouldPoll(newestExpected, now) {
  const polling = now - (newestExpected + EARLIEST_PUBLICATION);
  return polling < FAST_POLLING || new Date(now).getUTCMinutes() < 10;
}

/** Directory of a run on the CHMI server, "00" to "18". */
function hourDir(time) {
  return String(new Date(time).getUTCHours()).padStart(2, "0");
}

async function publishedRun(env, fetcher, now) {
  // The query string steps around the ten-minute cache of GitHub Pages.
  const response = await fetcher(`${env.SITE_URL}/data/forecast.json?t=${now}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`site answered ${response.status}`);
  const forecast = await response.json();
  const time = Date.parse(forecast.run_id);
  if (Number.isNaN(time)) throw new Error(`site has no usable run_id: ${forecast.run_id}`);
  return time;
}

async function listedRuns(env, fetcher, directories) {
  const runs = [];
  for (const directory of directories) {
    const response = await fetcher(`${env.SOURCE_URL}/${directory}/`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`CHMI answered ${response.status} for ${directory}/`);
    runs.push(...parseIndex(await response.text()));
  }
  return runs;
}

async function dispatch(env, fetcher) {
  const url =
    `https://api.github.com/repos/${env.GITHUB_REPO}` +
    `/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    // No inputs: a forced rebuild stays a manual decision.
    body: JSON.stringify({ ref: env.GITHUB_REF }),
  });
  if (response.status !== 204) {
    throw new Error(`GitHub answered ${response.status}: ${await response.text()}`);
  }
}

/**
 * One wake-up. Returns what it decided, so that the log and the tests can
 * tell the cases apart: idle, wait, dispatch, exhausted or error.
 */
export async function tick({ env, now, fetcher = fetch }) {
  let published;
  try {
    published = await publishedRun(env, fetcher, now);
  } catch (error) {
    return { action: "error", reason: `cannot read the site: ${error.message}` };
  }

  const expected = expectedRuns(published, now);
  if (expected.length === 0) {
    const due = published + RUN_STEP + EARLIEST_PUBLICATION;
    return { action: "idle", reason: `site has ${runId(published)}, next run due ${runId(due)}` };
  }
  const newest = expected[expected.length - 1];
  if (!shouldPoll(newest, now)) {
    return { action: "idle", reason: `${runId(newest)} is late, polling hourly` };
  }

  let listed;
  try {
    listed = await listedRuns(env, fetcher, [...new Set(expected.map(hourDir))]);
  } catch (error) {
    return { action: "error", reason: `cannot list CHMI: ${error.message}` };
  }
  const waiting = listed
    .filter((run) => run.time > published && run.files >= FILES_PER_RUN)
    .sort((a, b) => b.time - a.time)[0];
  if (!waiting) {
    const partial = listed.find((run) => run.time === newest);
    const files = partial ? partial.files : 0;
    return { action: "wait", reason: `${runId(newest)} has ${files}/${FILES_PER_RUN} files` };
  }

  const run = runId(waiting.time);
  const key = `dispatch:${run}`;
  const record = (await env.STATE.get(key, "json")) || { attempts: 0, last: 0 };
  if (record.attempts >= MAX_ATTEMPTS) {
    return { action: "exhausted", run, reason: `${record.attempts} dispatches did not publish ${run}` };
  }
  if (now - record.last < RETRY_AFTER) {
    return { action: "wait", run, reason: `dispatched at ${runId(record.last)}, waiting for the site` };
  }

  try {
    await dispatch(env, fetcher);
  } catch (error) {
    // Not counted as an attempt: nothing ran, so nothing was downloaded.
    return { action: "error", run, reason: `dispatch failed: ${error.message}` };
  }
  const attempts = record.attempts + 1;
  await env.STATE.put(key, JSON.stringify({ attempts, last: now }), {
    expirationTtl: RECORD_TTL_SECONDS,
  });
  return { action: "dispatch", run, reason: `attempt ${attempts} of ${MAX_ATTEMPTS}` };
}

export default {
  async scheduled(controller, env, ctx) {
    const outcome = await tick({ env, now: controller.scheduledTime });
    const line = `${outcome.action}: ${outcome.reason}`;
    if (outcome.action === "error" || outcome.action === "exhausted") console.error(line);
    else console.log(line);
  },
};
