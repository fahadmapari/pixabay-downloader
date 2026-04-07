/**
 * Pixabay Proxy Worker
 * Resolves a Pixabay image ID via the API, then fetches the image
 * from Pixabay's CDN using Cloudflare's IP — not the user's.
 *
 * Environment secrets (set via wrangler secret put):
 *   PIXABAY_KEY  — your Pixabay API key
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ error: "Only POST requests are accepted." }, 405);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400);
    }

    const { imageId } = body;

    if (!imageId || !/^\d+$/.test(String(imageId))) {
      return json({ error: "imageId must be a numeric string." }, 400);
    }

    if (!env.PIXABAY_KEY) {
      return json({ error: "PIXABAY_KEY secret is not configured on the worker." }, 500);
    }

    // ── Step 1: Resolve image metadata via Pixabay API ──────────────────────
    let imageUrl, tags, previewUrl;
    try {
      const apiRes = await fetch(
        `https://pixabay.com/api/?key=${env.PIXABAY_KEY}&id=${imageId}&per_page=3`,
        { headers: { "User-Agent": "PixabayProxy/1.0" } }
      );

      if (!apiRes.ok) {
        return json({ error: `Pixabay API returned ${apiRes.status}.` }, 502);
      }

      const data = await apiRes.json();

      if (!data.hits || data.hits.length === 0) {
        return json({ error: "No image found for this ID." }, 404);
      }

      const hit = data.hits[0];
      imageUrl   = hit.largeImageURL || hit.webformatURL;  // large preferred, medium fallback
      previewUrl = hit.previewURL;     // small thumbnail
      tags       = hit.tags || "";
    } catch (err) {
      return json({ error: `Failed to call Pixabay API: ${err.message}` }, 502);
    }

    // ── Step 2: Handle preview requests ─────────────────────────────────────
    if (body.previewOnly) {
      return json({ previewUrl, tags, imageId });
    }

    // ── Step 3: Fetch full image from CDN via Cloudflare IP ──────────────────
    let imgRes;
    try {
      imgRes = await fetch(imageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://pixabay.com/",
          "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        },
      });

      if (!imgRes.ok) {
        return json({ error: `CDN fetch failed with status ${imgRes.status}.` }, 502);
      }
    } catch (err) {
      return json({ error: `Failed to fetch image from CDN: ${err.message}` }, 502);
    }

    // ── Step 4: Use Pixabay's original filename from the CDN URL ────────────
    const filename = imageUrl.split("?")[0].split("/").pop() || `pixabay-${imageId}.jpg`;

    // ── Step 5: Stream image back to extension ───────────────────────────────
    return new Response(imgRes.body, {
      status: 200,
      headers: {
        "Content-Type": imgRes.headers.get("Content-Type") || "image/jpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Image-Tags": tags,
        "X-Image-Id": imageId,
        ...CORS_HEADERS,
      },
    });
  },
};
