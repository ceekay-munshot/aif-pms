// worker/index.js — Fund Screener — MGA
//
// Minimal Cloudflare Worker: it serves the static dashboard in ./public via the
// ASSETS binding and falls through to those assets for every route.
//
// NOTE: `/api/*` is reserved for a future prompt. No API routes are implemented
// yet — when they are, branch on `new URL(request.url).pathname` here BEFORE the
// asset fall-through below.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
