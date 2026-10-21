import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeApiError, parseApiResponse } from '../src/api-response.js'

test('parseApiResponse reads JSON response bodies', async () => {
  const response = new Response(JSON.stringify({ error: 'Falha de teste' }), {
    headers: { 'Content-Type': 'application/json' },
  })
  assert.deepEqual(await parseApiResponse(response), { error: 'Falha de teste' })
})

test('parseApiResponse accepts a bodyless 204 response', async () => {
  assert.deepEqual(await parseApiResponse(new Response(null, { status: 204 })), {})
})

test('parseApiResponse explains an empty server failure and preserves its status', async () => {
  await assert.rejects(
    parseApiResponse(new Response(null, { status: 503 })),
    (error) => error.status === 503 && error.message.includes('serviço está indisponível'),
  )
})

test('parseApiResponse explains an HTML response instead of exposing a JSON parse error', async () => {
  await assert.rejects(
    parseApiResponse(new Response('<!doctype html><title>Not found</title>', {
      headers: { 'Content-Type': 'text/html' },
    })),
    (error) => error.status === 200 && error.message.includes('página HTML'),
  )
})

test('normalizeApiError gives network failures a localized message', () => {
  assert.equal(
    normalizeApiError(new TypeError('Failed to fetch'), 'Não foi possível conectar aos dados.'),
    'Não foi possível conectar aos dados.',
  )
})
