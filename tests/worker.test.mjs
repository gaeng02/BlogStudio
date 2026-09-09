import test from 'node:test'
import assert from 'node:assert/strict'
import worker from '../deploy/worker.mjs'

test('only studio routes reach EC2 and OAuth redirects/cookies remain intact', async (t) => {
  const requests = []
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (request, options) => {
    requests.push({request, options})
    return new Response(null, {status: 303, headers: {
      Location: 'https://accounts.google.com/example', 'Set-Cookie': 'session=opaque; HttpOnly; Path=/studio',
    }})
  }
  const env = { ORIGIN_URL: 'https://origin.example.com' }
  await worker.fetch(new Request('https://www.gaeng02.com/studio-other'), env)
  assert.equal(requests[0].request.url, 'https://www.gaeng02.com/studio-other')
  const result = await worker.fetch(new Request('https://www.gaeng02.com/studio/auth/login?from=test'), env)
  assert.equal(requests[1].request.url, 'https://origin.example.com/studio/auth/login?from=test')
  assert.equal(requests[1].options.redirect, 'manual')
  assert.equal(result.status, 303)
  assert.equal(result.headers.get('location'), 'https://accounts.google.com/example')
  assert.equal(result.headers.get('set-cookie'), 'session=opaque; HttpOnly; Path=/studio')
  assert.match(result.headers.get('cache-control'), /no-store/)
  const redirect = await worker.fetch(new Request('http://www.gaeng02.com/studio/'), env)
  assert.equal(redirect.status, 308)
  assert.equal(redirect.headers.get('location'), 'https://www.gaeng02.com/studio/')
  assert.equal((await worker.fetch(new Request('https://www.gaeng02.com/studio'), {ORIGIN_URL: 'https://www.gaeng02.com'})).status, 503)
})
