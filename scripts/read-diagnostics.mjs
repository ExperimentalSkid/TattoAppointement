import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

// Operator-only file reader. There is deliberately no web endpoint for logs.
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const reference = option("--report");
const artist = option("--artist");
if ((!reference && !artist) || (reference && !/^[a-f0-9-]{36}$/i.test(reference)) || (artist && !/^[A-Za-z0-9_-]{1,128}$/.test(artist))) {
  throw new Error("Use --report <reference> or --artist <account-id>. Optional --directory <private-log-folder>.");
}
const directory = path.resolve(option("--directory") || process.env.DIAGNOSTICS_DIR || ".data/diagnostics");
const files = (await readdir(directory)).filter(file => /^(reports|diagnostics)-\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
async function records(kind, since = 0, until = Infinity) {
  const selected = files.filter(file => file.startsWith(`${kind}-`) && Date.parse(`${file.slice(kind.length + 1, -6)}T00:00:00.000Z`) + 86_400_000 > since);
  const result = [];
  for (const file of selected) {
    const filename = path.join(directory, file);
    if ((await stat(filename)).size > (kind === "reports" ? 5 : 10) * 1024 * 1024) throw new Error("Log exceeds the expected bound");
    for (const line of (await readFile(filename, "utf8")).split("\n")) {
      if (!line) continue;
      const row = JSON.parse(line);
      const received = Date.parse(row.receivedAt);
      if (received >= since && received <= until) result.push(row);
    }
  }
  return result;
}
if (reference) {
  const report = (await records("reports")).find(row => row.reference === reference);
  if (!report) { console.log(JSON.stringify({ found: false })); process.exitCode = 1; }
  else {
    const clicked = Date.parse(report.clickedAt);
    const linked = new Set(report.recentEvents.map(event => event.id));
    const events = (await records("diagnostics", clicked - 15 * 60_000, Date.parse(report.receivedAt) + 5 * 60_000))
      .filter(row => row.artistId === report.artistId && (report.artistId !== null || linked.has(row.id)));
    console.log(JSON.stringify({ report, events }, null, 2));
  }
} else {
  const since = Date.now() - 24 * 60 * 60_000;
  console.log(JSON.stringify({ artistId: artist, since: new Date(since).toISOString(),
    reports: (await records("reports", since)).filter(row => row.artistId === artist),
    events: (await records("diagnostics", since)).filter(row => row.artistId === artist) }, null, 2));
}
