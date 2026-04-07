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
      // If webformat is already 1440px or wider, it's sufficient — skip largeImageURL
      const webformatIsLarge = (hit.webformatWidth || 0) >= 1440 || (hit.webformatHeight || 0) >= 1440;
      imageUrl   = webformatIsLarge ? hit.webformatURL : (hit.largeImageURL || hit.webformatURL);
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
    // Rotate through realistic Chrome UA strings to reduce fingerprinting
    const USER_AGENTS = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.122 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    ];
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    // Build a plausible Pixabay image page URL as the referer
    const referer = `https://pixabay.com/photos/${imageId}/`;

    let imgRes;
    try {
      imgRes = await fetch(imageUrl, {
        headers: {
          "User-Agent": ua,
          "Referer": referer,
          "Origin": "https://pixabay.com",
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Connection": "keep-alive",
          "Sec-Fetch-Dest": "image",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Site": "cross-site",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });

      if (!imgRes.ok) {
        // On 429, fall back to webformatURL if we were trying largeImageURL
        if (imgRes.status === 429 && imageUrl.includes("_1280")) {
          const fallbackUrl = imageUrl.replace(/_1280(\.\w+)$/, "_640$1");
          imgRes = await fetch(fallbackUrl, {
            headers: {
              "User-Agent": ua,
              "Referer": referer,
              "Origin": "https://pixabay.com",
              "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Sec-Fetch-Dest": "image",
              "Sec-Fetch-Mode": "no-cors",
              "Sec-Fetch-Site": "cross-site",
            },
          });
        }

        if (!imgRes.ok) {
          return json({ error: `CDN fetch failed with status ${imgRes.status}.` }, 502);
        }
      }
    } catch (err) {
      return json({ error: `Failed to fetch image from CDN: ${err.message}` }, 502);
    }

    // ── Step 4: Use Pixabay's original filename ──────────────────────────────
    // imgRes.url is the final URL after redirects (e.g. cdn.pixabay.com/photo/.../name-id_1280.jpg)
    const cdnFilename = (imgRes.url || imageUrl).split("?")[0].split("/").pop();
    const filename = cdnFilename || `pixabay-${imageId}.jpg`;

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
