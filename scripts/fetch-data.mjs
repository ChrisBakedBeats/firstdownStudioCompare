// Fetches the First Down Studio ranking pages and writes site/data.json.
// Exits non-zero (so the workflow deploys nothing) if the pages look wrong.
import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://www.firstdown.studio/rankings";
const PAGES = { QB: "", RB: "/rb", WR: "/wr", TE: "/te", K: "/k", FLEX: "/flex" };
const KEYS = {
  QB: ["py", "ptd", "int", "ry", "rtd"],
  RB: ["ry", "ra", "rec", "recy", "td"],
  WR: ["rec", "recy", "td"],
  TE: ["rec", "recy", "td"],
  K: ["tp"],
};
// Minimum rows we expect per page; fewer means the layout probably changed.
const MIN_ROWS = { QB: 20, RB: 30, WR: 30, TE: 15, K: 20, FLEX: 80 };
const UA = process.env.SCRAPER_UA || "firstdown-compare/1.0 (personal nightly refresh)";

const INJURY = /^(Q|O|D|IR|PUP|Questionable|Out|Doubtful|Probable)$/i;
const GAME = /([A-Z]{2,4})\s*(@|vs\.?)\s*([A-Z]{2,4})\s*$/;
const clean = (s) => s.replace(/\s+/g, " ").trim();
const toNum = (s) => {
  const t = s.replace(/,/g, "");
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

function parseNameCell($, td) {
  const whole = clean($(td).text());
  const g = whole.match(GAME);
  if (!g) return null;
  const leaves = [];
  $(td).find("*").each((_, e) => {
    if ($(e).children().length === 0) {
      const t = clean($(e).text());
      if (t) leaves.push(t);
    }
  });
  const cands = leaves.filter(
    (t) => !GAME.test(t) && !/^[A-Z]{1,3}$/.test(t) && !INJURY.test(t) && !/^(@|vs\.?)$/i.test(t)
  );
  let name = cands.sort((a, b) => b.length - a.length)[0];
  if (!name) {
    // Fallback for flattened text: initials + "Name" + "Name" + [injury] + game
    const rest = whole.slice(0, g.index).replace(/(Questionable|Doubtful|Out|IR|[QOD])$/, "").trim();
    for (let L = Math.floor(rest.length / 2); L >= 3; L--) {
      const x = rest.slice(-L);
      if (rest.slice(-2 * L, -L) === x) { name = x; break; }
    }
  }
  if (!name) return null;
  return { name, game: `${g[1]} ${g[2].replace(".", "")} ${g[3]}` };
}

function parsePage(html, pos) {
  const $ = cheerio.load(html);
  const rows = [];
  $("table tr").each((_, tr) => {
    const tds = $(tr).children("td");
    if (tds.length < 3) return; // tier header rows
    const m = clean($(tds[0]).text()).match(/(\d+)(?:\s*\([+\-−]?\d*\))?$/);
    if (!m) return;
    const cells = tds.slice(2).toArray().map((c) => clean($(c).text())).filter((t) => t !== "");

    if (pos === "FLEX") {
      const label = cells.find((t) => /^(RB|WR|TE)\d+$/.test(t));
      if (label) rows.push({ rk: Number(m[1]), label });
      return;
    }
    const who = parseNameCell($, tds[1]);
    if (!who) return;
    const vals = cells.map(toNum).filter((v) => v !== null);
    if (vals.length < 1 + KEYS[pos].length) return;
    if (vals[0] < 0 || vals[0] > 60) return;
    const o = { rk: Number(m[1]), name: who.name, game: who.game, pts: vals[0] };
    KEYS[pos].forEach((k, i) => (o[k] = vals[i + 1]));
    rows.push(o);
  });
  rows.sort((a, b) => a.rk - b.rk);

  const body = clean($("body").text());
  return {
    rows,
    week: (body.match(/Week (\d+)/) || [])[1] || null,
    updated: (body.match(/Updated:\s*(\d{1,2}\/\d{1,2}\s+\w+)/) || [])[1] || null,
  };
}

const positions = {};
const meta = {};
let flex = [];

for (const [pos, path] of Object.entries(PAGES)) {
  const { rows, week, updated } = parsePage(await get(BASE + path), pos);
  if (rows.length < MIN_ROWS[pos]) {
    throw new Error(`${pos}: parsed only ${rows.length} rows (expected >= ${MIN_ROWS[pos]}); layout may have changed`);
  }
  meta[pos] = { week, updated, count: rows.length };
  if (pos === "FLEX") flex = rows.map((r) => r.label);
  else positions[pos] = rows.map(({ rk, ...rest }) => ({ rk, ...rest }));
  console.log(`${pos}: ${rows.length} rows, week ${week}, updated ${updated}`);
  await sleep(2000); // be polite
}

const weeks = new Set(Object.values(meta).map((m) => m.week));
if (weeks.size > 1) console.warn("Warning: pages are on different weeks:", [...weeks].join(", "));

const have = new Set(Object.entries(positions).flatMap(([p, rows]) => rows.map((r) => p + r.rk)));
const unmatched = flex.filter((t) => !have.has(t));
if (unmatched.length > flex.length * 0.05) {
  throw new Error(`FLEX: ${unmatched.length} entries do not match RB/WR/TE rows`);
}

await mkdir("site", { recursive: true });
await writeFile("site/data.json", JSON.stringify({ generated: new Date().toISOString(), meta, positions, flex }));
console.log("Wrote site/data.json");
