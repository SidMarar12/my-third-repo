// netlify/functions/search-jobs.js
// Server-side proxy to Adzuna Jobs API.
// Inputs (query params): title, zip, radius (miles), days (0=any), page, pageSize
// Env vars required: ADZUNA_APP_ID, ADZUNA_APP_KEY
// Optional: ADZUNA_COUNTRY (default "us")

const REQUIRED_ENV = ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"];

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    for (const k of REQUIRED_ENV) {
      if (!process.env[k]) {
        return {
          statusCode: 500,
          headers: cors,
          body: JSON.stringify({ error: `Missing environment variable ${k}` }),
        };
      }
    }

    const params = event.queryStringParameters || {};
    const title = (params.title || "").trim();
    const zip = (params.zip || "").trim();
    const radiusMiles = parseInt(params.radius || "25", 10);
    const days = parseInt(params.days || "7", 10);
    const page = Math.max(1, parseInt(params.page || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(params.pageSize || "25", 10))); // defensive cap

    if (!title) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Missing 'title'." }) };
    }
    if (!/^\d{5}$/.test(zip)) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "ZIP must be 5 digits." }) };
    }
    if (Number.isNaN(radiusMiles) || radiusMiles < 1) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Invalid 'radius' (miles)." }) };
    }
    if (Number.isNaN(days) || days < 0 || days > 60) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Invalid 'days' (0–60)." }) };
    }

    const country = (process.env.ADZUNA_COUNTRY || "us").toLowerCase();
    const km = Math.max(1, Math.round(radiusMiles * 1.60934)); // miles -> km

    // Build query
    const qs = new URLSearchParams({
      app_id: process.env.ADZUNA_APP_ID,
      app_key: process.env.ADZUNA_APP_KEY,
      results_per_page: String(pageSize),
      what: title,
      where: zip,
      distance: String(km),
      sort_by: "date",
      "content-type": "application/json",
    });
    if (days > 0) qs.set("max_days_old", String(days));

    const url = `https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/${page}?${qs.toString()}`;

    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: cors,
        body: JSON.stringify({ error: "Upstream error", details: text.slice(0, 1000) }),
      };
    }

    const data = JSON.parse(text);
    const results = Array.isArray(data.results) ? data.results : [];

    const jobs = results.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company?.display_name || "",
      location: j.location?.display_name || "",
      posted: j.created,                          // ISO timestamp
      url: j.redirect_url,                        // open externally
      snippet: j.description || "",               // Adzuna provides a short snippet
      // 'distance' not returned by API; we filter by it server-side
    }));

    const total = Number.isFinite(+data.count) ? +data.count : jobs.length;

    return {
      statusCode: 200,
      headers: { ...cors, "Cache-Control": "no-store" },
      body: JSON.stringify({
        total,
        page,
        pageSize,
        jobs,
        source: "Adzuna",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: "Server error", details: String(err).slice(0, 500) }),
    };
  }
};