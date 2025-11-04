// Aggregate job search across Adzuna + CareerOneStop + USAJOBS,
// with normalization, dedupe, salary/date extraction, title-only filtering,
// and corrected pagination signaling.
//
// Query params: title, zip, radius (miles), days (0=any),
//               page, pageSize, sources=adzuna,cos,usajobs, titleStrict=0|1
//
// Env vars per source (skip a source if missing):
//   Adzuna:   ADZUNA_APP_ID, ADZUNA_APP_KEY, ADZUNA_COUNTRY (opt; default "us")
//   CoS:      COS_API_TOKEN, COS_USER_ID
//   USAJOBS:  USAJOBS_AUTH_KEY, USAJOBS_USER_AGENT

const DEFAULT_TIMEOUT_MS = 8000;

// ---------- utils ----------
function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function normalizeKey(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '').trim();
}
function hostFromUrl(u) { try { return new URL(u).hostname.replace(/^www\./,''); } catch { return ''; } }
function dedupe(items) {
  const seen = new Set(); const out = [];
  for (const j of items) {
    const key = [normalizeKey(j.title), normalizeKey(j.company), hostFromUrl(j.url), normalizeKey(j.location)].join('|');
    if (seen.has(key)) continue; seen.add(key); out.push(j);
  }
  return out;
}
function fetchJSON(url, { headers = {}, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { headers, signal: controller.signal })
    .then(async (res) => {
      const text = await res.text(); clearTimeout(t);
      let json = {}; try { json = text ? JSON.parse(text) : {}; } catch {}
      if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; err.body = text; throw err; }
      return json;
    })
    .catch((e) => { clearTimeout(t); throw e; });
}
function fmtCurrency(n, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `$${Math.round(n).toLocaleString('en-US')}`; }
}
function salaryTextFromMinMax(min, max, { currency = 'USD', unit = '' } = {}) {
  const hasMin = Number.isFinite(min), hasMax = Number.isFinite(max);
  if (!hasMin && !hasMax) return '';
  if (hasMin && hasMax) {
    if (Math.round(min) === Math.round(max)) return `${fmtCurrency(min, currency)}${unit ? '/' + unit : ''}`;
    return `${fmtCurrency(min, currency)}–${fmtCurrency(max, currency)}${unit ? '/' + unit : ''}`;
  }
  const v = hasMin ? min : max;
  return `${fmtCurrency(v, currency)}${unit ? '/' + unit : ''}`;
}
function unitFromUSAJOBS(code = '') {
  const m = String(code).toLowerCase();
  if (m.includes('year')) return 'yr';
  if (m.includes('hour')) return 'hr';
  if (m.includes('week')) return 'wk';
  if (m.includes('month')) return 'mo';
  if (m.includes('day')) return 'day';
  return '';
}
function safeTime(iso) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; }

// ---------- providers ----------
async function fetchAdzuna(q, page, pageSize) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) return { source: 'Adzuna', jobs: [], total: 0, error: 'ADZUNA credentials missing' };

  const country = (process.env.ADZUNA_COUNTRY || 'us').toLowerCase();
  const km = Math.max(1, Math.round(q.radiusMiles * 1.60934)); // miles → km

  const qs = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(pageSize),
    what: q.title,
    where: q.zip,
    distance: String(km),
    sort_by: 'date',
    'content-type': 'application/json'
  });
  if (q.days > 0) qs.set('max_days_old', String(q.days));

  const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}?${qs}`;
  try {
    const d = await fetchJSON(url, { headers: { Accept: 'application/json' } });
    const arr = Array.isArray(d.results) ? d.results : [];
    const jobs = arr.map((x) => {
      const min = Number(x.salary_min), max = Number(x.salary_max);
      const currency = x.salary_currency || 'USD';
      const salaryText = salaryTextFromMinMax(min, max, { currency });
      return {
        id: x.id,
        title: x.title || '',
        company: x.company?.display_name || '',
        location: x.location?.display_name || '',
        posted: x.created || '',
        url: x.redirect_url,
        snippet: x.description || '',
        salaryText,
        source: 'Adzuna'
      };
    });
    const total = Number.isFinite(+d.count) ? +d.count : jobs.length;
    return { source: 'Adzuna', jobs, total };
  } catch (e) {
    return { source: 'Adzuna', jobs: [], total: 0, error: String(e.message || e) };
  }
}

async function fetchCOS(q, page, pageSize) {
  const token = process.env.COS_API_TOKEN, userId = process.env.COS_USER_ID;
  if (!token || !userId) return { source: 'CareerOneStop', jobs: [], total: 0, error: 'CareerOneStop credentials missing' };

  const sortCol = 'acquisitiondate', sortOrder = 'desc', startRecord = (page - 1) * pageSize;
  const parts = [
    encodeURIComponent(userId),
    encodeURIComponent(q.title),
    encodeURIComponent(q.zip),
    encodeURIComponent(String(q.radiusMiles)),
    encodeURIComponent(sortCol),
    encodeURIComponent(sortOrder),
    encodeURIComponent(String(startRecord)),
    encodeURIComponent(String(pageSize)),
    encodeURIComponent(String(q.days))
  ];
  const url = `https://api.careeronestop.org/v2/jobsearch/${parts.join('/')}?enableJobDescriptionSnippet=true&enableMetaData=false`;

  try {
    const d = await fetchJSON(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const arr = Array.isArray(d.Jobs) ? d.Jobs : [];
    const jobs = arr.map((x) => {
      // CoS salary signals are inconsistent; try numeric min/max first, then text fields.
      const nums = [
        Number(x.MinimumSalary), Number(x.SalaryMin), Number(x.WageMin),
        Number(x.MaximumSalary), Number(x.SalaryMax), Number(x.WageMax)
      ].filter(Number.isFinite);
      let salaryText = '';
      if (nums.length) {
        const min = Math.min(...nums), max = Math.max(...nums);
        salaryText = salaryTextFromMinMax(min, max, { currency: 'USD' });
      } else {
        const textCandidate = x.Pay || x.Wage || x.Salary || x.PayDescription || '';
        salaryText = typeof textCandidate === 'string' ? textCandidate : '';
      }
      return {
        id: x.JvId,
        title: x.JobTitle || '',
        company: x.Company || '',
        location: x.Location || '',
        posted: x.AcquisitionDate || '',
        url: x.URL,
        snippet: x.DescriptionSnippet || '',
        salaryText,
        source: 'CareerOneStop'
      };
    });
    const total = parseInt(d.JobCount || '0', 10) || jobs.length;
    return { source: 'CareerOneStop', jobs, total };
  } catch (e) {
    return { source: 'CareerOneStop', jobs: [], total: 0, error: String(e.message || e) };
  }
}

async function fetchUSAJOBS(q, page, pageSize) {
  const key = process.env.USAJOBS_AUTH_KEY, ua = process.env.USAJOBS_USER_AGENT;
  if (!key || !ua) return { source: 'USAJOBS', jobs: [], total: 0, error: 'USAJOBS credentials missing' };

  const p = new URLSearchParams({
    PositionTitle: q.title,
    LocationName: q.zip,
    Radius: String(q.radiusMiles),
    ResultsPerPage: String(pageSize),
    Page: String(page)
  });
  if (q.days > 0) p.set('DatePosted', String(q.days));
  const url = `https://data.usajobs.gov/api/Search?${p}`;

  try {
    const d = await fetchJSON(url, {
      headers: { 'Host': 'data.usajobs.gov', 'User-Agent': ua, 'Authorization-Key': key, 'Accept': 'application/json' }
    });
    const sr = d.SearchResult || {};
    const items = Array.isArray(sr.SearchResultItems) ? sr.SearchResultItems : [];
    const jobs = items.map((it) => {
      const m = it.MatchedObjectDescriptor || {};
      const link = Array.isArray(m.ApplyURI) ? m.ApplyURI[0] : (m.PositionURI || '');
      const posted = m.PublicationStartDate || m.OpenDate || m.OpeningDate || '';
      // Salary
      let salaryText = '';
      const rem = Array.isArray(m.PositionRemuneration) ? m.PositionRemuneration : [];
      if (rem.length) {
        const currency = rem[0].CurrencyCode || 'USD';
        const unit = unitFromUSAJOBS(rem[0].RateIntervalCode || rem[0].RateIntervalDescription || '');
        const mins = rem.map(r => Number(r.MinimumRange)).filter(Number.isFinite);
        const maxs = rem.map(r => Number(r.MaximumRange)).filter(Number.isFinite);
        const min = mins.length ? Math.min(...mins) : NaN;
        const max = maxs.length ? Math.max(...maxs) : NaN;
        salaryText = salaryTextFromMinMax(min, max, { currency, unit });
      }
      return {
        id: it.MatchedObjectId || m.PositionID || link,
        title: m.PositionTitle || '',
        company: m.OrganizationName || m.DepartmentName || '',
        location: m.PositionLocationDisplay || '',
        posted,
        url: link,
        snippet: m.UserArea?.Details?.JobSummary || '',
        salaryText,
        source: 'USAJOBS'
      };
    });
    const total = Number.isFinite(+sr.SearchResultCountAll) ? +sr.SearchResultCountAll : jobs.length;
    return { source: 'USAJOBS', jobs, total };
  } catch (e) {
    return { source: 'USAJOBS', jobs: [], total: 0, error: String(e.message || e) };
  }
}

// ---------- function handler ----------
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const q = event.queryStringParameters || {};
    const title = (q.title || '').trim();
    const zip = (q.zip || '').trim();
    const radiusMiles = int(q.radius || '25', 25);
    const days = int(q.days || '7', 7);
    const page = Math.max(1, int(q.page || '1', 1));
    const pageSize = Math.min(50, Math.max(1, int(q.pageSize || '25', 25)));
    const sources = (q.sources || 'adzuna,cos,usajobs').split(',').map(s => s.trim().toLowerCase());
    const titleStrict = String(q.titleStrict || '0') === '1';

    if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'title'." }) };
    if (!/^\d{5}$/.test(zip)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ZIP must be 5 digits.' }) };
    if (radiusMiles < 1) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid 'radius' (miles)." }) };
    if (days < 0 || days > 60) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid 'days' (0–60)." }) };

    const query = { title, zip, radiusMiles, days };

    const tasks = [];
    if (sources.includes('adzuna')) tasks.push(fetchAdzuna(query, page, pageSize));
    if (sources.includes('cos')) tasks.push(fetchCOS(query, page, pageSize));
    if (sources.includes('usajobs')) tasks.push(fetchUSAJOBS(query, page, pageSize));

    const settled = await Promise.allSettled(tasks);

    let all = []; const providers = []; const errors = [];
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        const { source, jobs, total, error } = s.value;
        providers.push({ source, total });
        if (error) errors.push({ source, error });
        all = all.concat(jobs || []);
      } else {
        errors.push({ source: 'unknown', error: String(s.reason) });
      }
    }

    // Merge, optional title-only filter, then sort newest -> oldest
    let merged = dedupe(all);
    if (titleStrict) {
      const needle = title.toLowerCase();
      merged = merged.filter(j => (j.title || '').toLowerCase().includes(needle));
    }
    merged.sort((a, b) => safeTime(b.posted) - safeTime(a.posted));

    // We page at the provider level; each provider already received `page`.
    // For the response body we just return the first `pageSize` after merge.
    const jobsPage = merged.slice(0, pageSize);

    // Use the max provider reported total as an approximation to drive the pager.
    const approxTotal = providers.reduce((m, p) => Math.max(m, Number(p.total) || 0), 0);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        total: approxTotal,
        page,
        pageSize,
        jobs: jobsPage,
        providers,
        errors,
        source: 'aggregated'
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error', details: String(e).slice(0, 400) }) };
  }
};