/**
 * Wedding Photo Upload — Cloudflare Worker
 *
 * Receives a photo POST from the wedding page and forwards it to the
 * GitHub Contents API. The PAT never leaves this environment.
 *
 * Environment variables (set in the Cloudflare dashboard or wrangler.toml):
 *   GITHUB_TOKEN  — fine-grained PAT with Contents: read+write on the photo repo
 *   GITHUB_OWNER  — repo owner username
 *   GITHUB_REPO   — repo name
 *   UPLOAD_PATH   — folder inside the repo, e.g. "uploads"
 *   ALLOWED_ORIGIN — the exact GitHub Pages URL of your site, e.g.
 *                    "https://yourname.github.io"
 *                    (used for CORS — only your page can call this worker)
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // ── CORS pre-flight ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env.ALLOWED_ORIGIN);
    }

    // ── Only accept POST /upload ─────────────────────────────
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/upload') {
      return corsResponse(JSON.stringify({ error: 'Not found' }), 404, env.ALLOWED_ORIGIN);
    }

    // ── Parse multipart form data ────────────────────────────
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return corsResponse(JSON.stringify({ error: 'Invalid form data' }), 400, env.ALLOWED_ORIGIN);
    }

    const file      = formData.get('file');       // File blob
    const filename  = formData.get('filename');   // Sanitised filename from the page

    if (!file || !filename) {
      return corsResponse(JSON.stringify({ error: 'Missing file or filename' }), 400, env.ALLOWED_ORIGIN);
    }

    // ── Convert to base64 for the GitHub API ─────────────────
    const arrayBuffer = await file.arrayBuffer();
    const base64      = arrayBufferToBase64(arrayBuffer);

    // ── Push to GitHub ───────────────────────────────────────
    const ghPath = `${env.UPLOAD_PATH}/${filename}`;
    const ghUrl  = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${ghPath}`;

    const ghRes = await fetch(ghUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.github+json',
        'User-Agent': 'wedding-photo-worker',
      },
      body: JSON.stringify({
        message: `Add wedding photo: ${filename}`,
        content: base64,
      }),
    });

    if (!ghRes.ok) {
      const detail = await ghRes.json().catch(() => ({}));
      return corsResponse(
        JSON.stringify({ error: detail.message || `GitHub error ${ghRes.status}` }),
        502,
        env.ALLOWED_ORIGIN,
      );
    }

    return corsResponse(JSON.stringify({ ok: true, path: ghPath }), 200, env.ALLOWED_ORIGIN);
  },
};

// ── Helpers ──────────────────────────────────────────────────

function corsResponse(body, status, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Origin':  allowedOrigin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  return new Response(body, { status, headers });
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
