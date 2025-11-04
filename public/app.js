const form = document.getElementById('searchForm');
const statusEl = document.getElementById('status');
const resultsBody = document.getElementById('results');
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
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function adzunaBadge() {
  return `
    <span class="source-badge">
      <a href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer">Jobs</a> by
      <a class="adzuna-logo-link" href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" aria-label="Adzuna">
        <img src="https://zunastatic-abf.kxcdn.com/assets/images/press/adzuna_logo/adzuna_logo.jpg" alt="Adzuna" width="90" height="18" />
      </a>
    </span>`;
}

function renderRows(items, append = false) {
  const rows = items.map(j => {
    const title = escapeHTML(j.title || '');
    const company = escapeHTML(j.company || '');
    const loc = escapeHTML(j.location || '');
    const posted = compactDate(j.posted);
    const salaryText = escapeHTML(j.salaryText || '');
    const snippet = escapeHTML((j.snippet || '').trim());
    const source = j.source || '';

    const sourceHtml = source === 'Adzuna'
      ? `<div class="source">${adzunaBadge()}</div>`
      : (source ? `<div class="source">Source: ${escapeHTML(source)}</div>` : '');

    return `
      <tr class="job-row">
        <td class="cell-job">
          <h3 class="job-title"><a href="${j.url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
          <p class="meta">
            ${company ? `<span>${company}</span>` : ''}${company && loc ? ' · ' : ''}${loc ? `<span>${loc}</span>` : ''}
          </p>
          ${snippet ? `<p class="snippet">${snippet}</p>` : ''}
          ${sourceHtml}
        </td>
        <td class="cell-posted">${posted || '—'}</td>
        <td class="cell-salary">${salaryText || '—'}</td>
      </tr>`;
  }).join('');

  if (!append) resultsBody.innerHTML = '';
  resultsBody.insertAdjacentHTML('beforeend', rows || '<tr><td colspan="3">No results.</td></tr>');
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
    pageSize: String(pageSize)
  });

  try {
    const res = await fetch(`${API_ENDPOINT}?${qs.toString()}`, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    const total = Number.isFinite(+data.total) ? +data.total : null;
    const providerTxt = Array.isArray(data.providers) && data.providers.length
      ? ' | ' + data.providers.map(p => `${p.source}:${p.total ?? 0}`).join(', ')
      : '';

    if (total) {
      statusEl.textContent = `Showing ${Math.min(page * pageSize, total)} of ${total}${providerTxt}`;
    } else {
      statusEl.textContent = `Showing ${data.jobs?.length || 0}${providerTxt}`;
    }

    renderRows(data.jobs || [], append);

    if (total && page * pageSize < total) {
      pagerEl.hidden = false;
      loadMoreBtn.onclick = () => { page += 1; runSearch(q, { append: true }); };
    } else {
      pagerEl.hidden = true;
    }
  } catch (e) {
    statusEl.textContent = `Error: ${e.message}`;
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

// optional input sanitization as user types
document.getElementById('zip').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
});