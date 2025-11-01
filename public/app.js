const form = document.getElementById('searchForm');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
const pagerEl = document.getElementById('pager');
const loadMoreBtn = document.getElementById('loadMore');

let lastQuery = null;
let page = 1;
const pageSize = 25;

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function renderJobs(items, append=false) {
  const cards = items.map(j => {
    const snippet = escapeHTML((j.snippet || '').trim());
    const loc = escapeHTML(j.location || '');
    const title = escapeHTML(j.title || '');
    const company = escapeHTML(j.company || '');
    const posted = j.posted ? new Date(j.posted).toLocaleDateString() : '';
    return `
      <article class="job">
        <h3 class="job-title"><a href="${j.url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>
        <p class="meta">
          ${company ? `<span>${company}</span>` : ''} 
          ${company && loc ? '·' : ''} 
          ${loc ? `<span>${loc}</span>` : ''}
          ${posted ? ' · ' : ''} 
          ${posted ? `<span>${posted}</span>` : ''}
        </p>
        ${snippet ? `<p class="snippet">${snippet}</p>` : ''}
      </article>`;
  }).join('');

  if (!append) resultsEl.innerHTML = '';
  resultsEl.insertAdjacentHTML('beforeend', cards || '<p>No results.</p>');
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
  });

  try {
    const res = await fetch(`/.netlify/functions/search-jobs?${qs.toString()}`, { method: 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    const total = Number.isFinite(+data.total) ? +data.total : null;
    if (total) {
      statusEl.textContent = `Showing ${Math.min(data.page * data.pageSize, total)} of ${total} ${data.source || ''}`.trim();
    } else {
      statusEl.textContent = `Showing ${data.jobs?.length || 0} results ${data.source ? `from ${data.source}` : ''}`.trim();
    }

    renderJobs(data.jobs || [], append);

    if (total && data.page * data.pageSize < total) {
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
  const zip = document.getElementById('zip').value.trim();
  const radius = parseInt(document.getElementById('radius').value, 10);
  const days = parseInt(document.getElementById('days').value, 10);
  if (!title || !/^\d{5}$/.test(zip)) return;

  lastQuery = { title, zip, radius, days };
  page = 1;
  runSearch(lastQuery);
});