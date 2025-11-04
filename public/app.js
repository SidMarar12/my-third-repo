const form = document.getElementById('searchForm');
const statusEl = document.getElementById('status');
const resultsBody = document.getElementById('results');
const emptyState = document.getElementById('empty-state');
const pagerEl = document.getElementById('pager');
const loadMoreBtn = document.getElementById('loadMore');

let lastQuery = null;
let page = 1;
const pageSize = 25;
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

// Compact, compliant per‑row Adzuna mark (min 116×23)
function adzunaBadge() {
  return `
    <span class="source-adzuna">
      <a class="adzuna-jobs-link" href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer">Jobs</a> by
      <a class="adzuna-logo-link" href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" aria-label="Adzuna">
        <img src="https://zunastatic-abf.kxcdn.com/assets/images/press/adzuna_logo/adzuna_logo.jpg" alt="Adzuna" width="116" height="23" />
      </a>
    </span>`;
}

function renderRows(items, append = false) {
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

  if (!append) resultsBody.innerHTML = '';
  resultsBody.insertAdjacentHTML('beforeend', rows);

  // empty state
  const hasRows = (resultsBody.children.length > 0);
  emptyState.hidden = hasRows;
  if (!hasRows && !append) {
    resultsBody.innerHTML = '<tr><td colspan="3"></td></tr>'; // keep table height; content sits in empty state
  }
}

async function runSearch(q, { append = false } = {}) {
  statusEl.textContent = 'Searching…';
  document.getElementById('go').disabled = true;

  const qs = new URLSearchParams({
    title: q.title,
    zip: q.zip,
    radius: String(q.radius),
    days: String(q.days),
    page: String(page),
    pageSize: String(pageSize),
    titleStrict: '1'              // title-only matching for higher precision
  });

  try {
    const res = await fetch(`${API_ENDPOINT}?${qs.toString()}`, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    const total = Number.isFinite(+data.total) ? +data.total : null;
    const providerTxt = Array.isArray(data.providers) && data.providers.length
      ? ' | ' + data.providers.map(p => `${p.source}:${p.total ?? 0}`).join(', ')
      : '';

    statusEl.textContent = total
      ? `Showing ${Math.min(page * pageSize, total)} of ${total}${providerTxt}`
      : `Showing ${data.jobs?.length || 0}${providerTxt}`;

    if (Array.isArray(data.jobs) && data.jobs.length > 0) {
      renderRows(data.jobs, append);
    } else {
      // show empty state cleanly
      resultsBody.innerHTML = '';
      emptyState.hidden = false;
    }

    if (total && page * pageSize < total) {
      pagerEl.hidden = false;
      loadMoreBtn.onclick = () => { page += 1; runSearch(q, { append: true }); };
    } else {
      pagerEl.hidden = true;
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
    resultsBody.innerHTML = '';
    emptyState.hidden = false;
  } finally {
    document.getElementById('go').disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value.trim();
  const zip = document.getElementById('zip').value.replace(/\D/g, '').slice(0,5);
  const radius = parseInt(document.getElementById('radius').value, 10);
  const days = parseInt(document.getElementById('days').value, 10);
  if (!title || !/^\d{5}$/.test(zip)) return;

  document.getElementById('zip').value = zip; // sanitize visually
  lastQuery = { title, zip, radius, days };
  page = 1;
  runSearch(lastQuery);
});

document.getElementById('zip').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
});