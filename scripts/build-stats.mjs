// Counts the commits of every repository in the organisation and writes
// data/stats.json for the page. Runs in the deploy workflow; locally:
//
//   GITHUB_TOKEN=$(gh auth token) node scripts/build-stats.mjs
//
// Private repositories (only visible with a token that may read them) add to
// the total, but their names never end up in the public file.
import { mkdir, writeFile } from 'node:fs/promises';

const ORG = process.env.ORG || 'Akinara-Lab';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const OUT = new URL('../data/stats.json', import.meta.url);

async function api(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'stats-builder' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers });
}

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const r = await api(`/orgs/${ORG}/repos?type=all&per_page=100&page=${page}`);
    if (!r.ok) throw new Error(`listing repositories failed: ${r.status} ${await r.text()}`);
    const batch = await r.json();
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
}

async function countCommits(fullName) {
  const r = await api(`/repos/${fullName}/commits?per_page=1`);
  if (r.status === 409) return 0; // empty repository
  if (!r.ok) throw new Error(`${fullName}: ${r.status}`);
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(r.headers.get('link') || '');
  return last ? Number(last[1]) : (await r.json()).length;
}

try {
  const all = (await listRepos()).filter((repo) => !repo.fork);
  const counted = await Promise.all(all.map(async (repo) => ({ repo, commits: await countCommits(repo.full_name) })));
  const open = counted.filter((x) => !x.repo.private);
  const closed = counted.filter((x) => x.repo.private);
  const stats = {
    org: ORG,
    commits: counted.reduce((n, x) => n + x.commits, 0),
    privateCommits: closed.reduce((n, x) => n + x.commits, 0),
    repos: open
      .map((x) => ({ name: x.repo.name, url: x.repo.html_url, commits: x.commits }))
      .filter((x) => x.commits > 0)
      .sort((a, b) => b.commits - a.commits),
    generatedAt: new Date().toISOString(),
  };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(stats, null, 2) + '\n');
  console.log(`${stats.commits} commits in ${counted.length} repositories (${closed.length} private)`);
} catch (err) {
  // keep the last committed snapshot rather than failing the deploy
  console.warn(`::warning::stats not updated: ${err.message}`);
}
