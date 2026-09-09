// Attach routes for www.gaeng02.com/studio* in Cloudflare; other paths pass through.
// ORIGIN_URL is the HTTPS address of the EC2 origin (without a path).
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/studio' && !url.pathname.startsWith('/studio/')) return fetch(request)
    if (url.protocol !== 'https:') {
      url.protocol = 'https:'
      return Response.redirect(url.href, 308)
    }
    const origin = new URL(env.ORIGIN_URL)
    if (origin.protocol !== 'https:' || origin.origin === url.origin) return new Response('Invalid studio origin', { status: 503 })
    origin.pathname = url.pathname
    origin.search = url.search
    const upstream = new Request(origin, request)
    // Keep redirects pointing at STUDIO_URL. Never follow OAuth redirects in the Worker.
    try {
      const response = await fetch(upstream, { redirect: 'manual', cf: { cacheEverything: false, cacheTtl: 0 } })
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'private, no-store')
      headers.set('X-Robots-Tag', 'noindex, nofollow')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch {
      return new Response('BlogStudio is temporarily unavailable.', { status: 502, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
    }
  },
}
