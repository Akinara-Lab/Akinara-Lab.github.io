// Where the commit count comes from.
//
// 1. data/stats.json – a snapshot written by scripts/build-stats.mjs on every
//    deploy. Instant, no rate limit.
// 2. The public GitHub API – asked once per visit so that a push shows up
//    without waiting for the next deploy. Fails silently (60 requests/hour).
// 3. ?commits=1234 in the address bar – preview of any tree size.

const ORG = 'Akinara-Lab';
const API = 'https://api.github.com';
const CACHE_KEY = 'akinara-live-stats';
const CACHE_MINUTES = 10;

export async function loadStats() {
  const q = new URLSearchParams(location.search);
  if (q.has('commits')) {
    return { commits: Math.max(0, parseInt(q.get('commits'), 10) || 0), repos: [], preview: true };
  }
  try {
    const r = await fetch('data/stats.json', { cache: 'no-cache' });
    if (r.ok) return await r.json();
  } catch {
    /* fall through to the live count */
  }
  return null;
}

// Number of commits on the default branch: ask for one commit per page and
// read the number of the last page from the Link header.
async function countCommits(fullName) {
  const r = await fetch(`${API}/repos/${fullName}/commits?per_page=1`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 409) return 0; // empty repository
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(r.headers.get('link') || '');
  if (last) return parseInt(last[1], 10);
  return (await r.json()).length;
}

export async function loadLive() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < CACHE_MINUTES * 60000) return cached.stats;
  } catch {
    /* no storage, no cache */
  }
  const r = await fetch(`${API}/orgs/${ORG}/repos?type=public&per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub API ${r.status}`);
  const list = (await r.json()).filter((repo) => !repo.fork);
  const repos = await Promise.all(
    list.map(async (repo) => ({ name: repo.name, url: repo.html_url, commits: await countCommits(repo.full_name) })),
  );
  repos.sort((a, b) => b.commits - a.commits);
  const stats = { commits: repos.reduce((n, x) => n + x.commits, 0), repos };
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), stats }));
  } catch {
    /* ignore */
  }
  return stats;
}
