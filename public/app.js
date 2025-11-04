const form = document.getElementById('searchForm');
const statusEl = document.getElementById('status');
const resultsBody = document.getElementById('results');
const emptyState = document.getElementById('empty-state');
const pagerEl = document.getElementById('pager');
const loadMoreBtn = document.getElementById('loadMore');
const searchBtn = document.getElementById('go');

let page = 1;
const pageSize = 25;
let shown = 0;
let loading = false;
const API_ENDPOINT = '/.netlify/functions/search-aggregate';

function escapeHTML(s = '') {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function compactDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function ageBadge(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / (24*3600*1000));
  if (days <= 0) return '<span class="badge new">New</span>';
  if (days === 1) return '<span class="badge">Yesterday</span>';
  return `<span class="badge">${days}d</span>`;
}
function adzunaBadge() {
  return `
    <span class="source-adzuna">
      <a class="adzuna-jobs-link" href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer">Jobs</a> by
      <a class="adzuna-logo-link" href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" aria-label="Adzuna">
        <img src="https://zunastatic-abf.kxcdn.com/assets/images/press/adzuna_logo/adzuna_logo.jpg" alt="Adzuna" width="116" height="23" />
      </a>
    </span>`;
}

// skeletons (first page only)
function renderSkeletonRows(n = 4) {
  const row = () => `
    <tr class="skel-row">
      <td>
        <div class="skel skel-title"></div>
        <div class="skel skel-line"></div>
        <div class="skel skel-line short"></div>
      </td>
      <td><div class="skel skel-chip"></div></td>
      <td><div class="skel skel-chip"></div></td>
    </tr>`;
  resultsBody.innerHTML = Array.from({ length: n }, row).join('');
  emptyState.hidden = true;
}

function renderRows(items) {
  const rows = items.map(j => {
    const title = escapeHTML(j.title || '');
    const company = escapeHTML(j.company || '');
    const loc = escapeHTML(j.location || '');
    const postedDate = compactDate(j.posted);
    const postedCell = `${ageBadge(j.posted)} ${postedDate || '—'}`;
    const salaryText = escapeHTML(j.salaryText || '');
    const snippet = escapeHTML((j.snippet || '').trim());
    const source = j.source || '';
    const sourceHtml =
      source === 'Adzuna'
        ? `<div class="source source--right">${adzunaBadge()}</div>`
        : (source ? `<div class="source source--right">Source: ${escapeHTML(source)}</div>` : '');

    return `
      <tr class="job-row">
        <td class="cell-job">
          <h3 class="job-title"><a href="${j.url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
          <p class="meta">${company ? `<span>${company}</span>` : ''}${company && loc ? ' · ' : ''}${loc ? `<span>${loc}</span>` : ''}</p>
          ${snippet ? `<p class="snippet">${snippet}</p>` : ''}
          ${sourceHtml}
        </td>
        <td class="cell-posted">${postedCell}</td>
        <td class="cell-salary">${salaryText || '—'}</td>
      </tr>`;
  }).join('');

  resultsBody.insertAdjacentHTML('beforeend', rows);
  shown += items.length;
  emptyState.hidden = true;
}

function updateStatus(total, providers) {
  const providerTxt = Array.isArray(providers) && providers.length
    ? ' | ' + providers.map(p => `${p.source}:${p.total ?? 0}`).join(', ')
    : '';
  if (Number.isFinite(+total)) {
    statusEl.textContent = `Showing ${Math.min(shown, +total)} of ${total}${providerTxt}`;
  } else {
    statusEl.textContent = `Showing ${shown}${providerTxt}`;
  }
}

async function runSearch(q, { append = false } = {}) {
  if (loading) return;
  loading = true;
  searchBtn.disabled = true;
  loadMoreBtn.disabled = true;

  if (!append) {
    page = 1; shown = 0;
    resultsBody.innerHTML = '';
    renderSkeletonRows(4);
  }

  const qs = new URLSearchParams({
    title: q.title,
    zip: q.zip,
    radius: String(q.radius),
    days: String(q.days),
    page: String(page),
    pageSize: String(pageSize),
    // Default to RELAXED title matching. You can test strict by manually adding &titleStrict=1
  });

  try {
    const res = await fetch(`${API_ENDPOINT}?${qs.toString()}`, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    if (!append) resultsBody.innerHTML = '';

    const items = Array.isArray(data.jobs) ? data.jobs : [];
    const total = Number.isFinite(+data.total) ? +data.total : null;

    if (items.length > 0) {
      renderRows(items);
    } else if (!append && shown === 0) {
      emptyState.hidden = false;
    }

    updateStatus(total, data.providers);

    if (total && shown < total && items.length > 0) {
      pagerEl.hidden = false;
      loadMoreBtn.onclick = () => { if (loading) return; page += 1; runSearch(q, { append: true }); };
    } else {
      pagerEl.hidden = true;
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    if (!append && shown === 0) {
      resultsBody.innerHTML = '';
      emptyState.hidden = false;
    }
  } finally {
    loading = false;
    searchBtn.disabled = false;
    loadMoreBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const zip = document.getElementById('zip').value.replace(/\D/g, '').slice(0,5);
  const radius = parseInt(document.getElementById('radius').value, 10);
  const days = parseInt(document.getElementById('days').value, 10);
  if (!title || !/^\d{5}$/.test(zip)) return;

  document.getElementById('zip').value = zip;
  const q = { title, zip, radius, days };
  runSearch(q, { append: false });
});

document.getElementById('zip').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
});