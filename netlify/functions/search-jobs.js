// netlify/functions/search-jobs.js
// Server-side proxy to CareerOneStop Jobs V2 API (US Dept. of Labor).

const REQUIRED_ENV = ["COS_API_TOKEN", "COS_USER_ID"];

exports.handler = async (event) => {
  try {
    // Basic CORS for same-origin usage from your site
    const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    // Validate env
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
    const pageSize = Math.min(50, Math.max(1, parseInt(params.pageSize || "25", 10))); // cap at 50

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
      // API allows 0 to get all; reasonable cap 60 days
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "Invalid 'days' (0–60)." }) };
    }

    const userId = process.env.COS_USER_ID;
    const token = process.env.COS_API_TOKEN;
    const sortCol = "acquisitiondate"; // most recent first
    const sortOrder = "desc";
    const startRecord = (page - 1) * pageSize;

    // Endpoint shape:
    // /v2/jobsearch/{userId}/{keyword}/{location}/{radius}/{sortColumns}/{sortOrder}/{startRecord}/{pageSize}/{days}
    const base = "https://api.careeronestop.org/v2/jobsearch";
    const path = [
      encodeURIComponent(userId),
      encodeURIComponent(title),
      encodeURIComponent(zip),
      encodeURIComponent(String(radiusMiles)),
      encodeURIComponent(sortCol),
      encodeURIComponent(sortOrder),
      encodeURIComponent(String(startRecord)),
      encodeURIComponent(String(pageSize)),
      encodeURIComponent(String(days)),
    ].join("/");

    const url = `${base}/${path}?enableJobDescriptionSnippet=true&enableMetaData=false`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        statusCode: res.status,
        headers: cors,
        body: JSON.stringify({ error: "Upstream error", details: text.slice(0, 500) }),
      };
    }

    const data = await res.json();

    const jobs = (data.Jobs || []).map((j) => ({
      id: j.JvId,
      title: j.JobTitle,
      company: j.Company,
      location: j.Location,            // e.g., "Oakland, CA"
      distance: j.Distance,            // miles as string per API
      posted: j.AcquisitionDate,       // ISO-ish string from API
      url: j.URL,                      // apply/details URL
      snippet: j.DescriptionSnippet || "",
    }));

    return {
      statusCode: 200,
      headers: { ...cors, "Cache-Control": "no-store" },
      body: JSON.stringify({
        total: parseInt(data.JobCount || "0", 10) || jobs.length,
        page,
        pageSize,
        jobs,
        source: "CareerOneStop",
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error", details: String(err).slice(0, 300) }),
    };
  }
};