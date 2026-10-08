import { describe, expect, it } from 'vitest';
import worker from '../../service/worker';

// The Worker adds nothing to the handler but its settings; the handler's own test covers the rest.
const settings = { NOTION_CLIENT_ID: 'id', NOTION_CLIENT_SECRET: 'secret', ALLOWED_ORIGIN: 'https://etalii.net' };

describe('the service as a Cloudflare Worker', () => {
  it('answers the preflight for the origin its settings allow', async () => {
    const request = new Request('https://adp-notion.example.workers.dev/notion/v1/users/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://etalii.net', 'Access-Control-Request-Method': 'GET' },
    });
    const answer = await worker.fetch(request, settings);
    expect(answer.headers.get('Access-Control-Allow-Origin')).toBe('https://etalii.net');
  });

  it('redirects a grant to Notion with its own address as where to come back', async () => {
    const state = 'a'.repeat(32);
    const answer = await worker.fetch(new Request(`https://adp-notion.example.workers.dev/authorize?state=${state}`), settings);
    expect(answer.status).toBe(302);
    const to = new URL(answer.headers.get('Location') ?? '');
    expect(to.searchParams.get('redirect_uri')).toBe('https://adp-notion.example.workers.dev/callback');
    expect(to.searchParams.get('client_id')).toBe('id');
  });

  it('answers 404 to anything else', async () => {
    const answer = await worker.fetch(new Request('https://adp-notion.example.workers.dev/else'), settings);
    expect(answer.status).toBe(404);
  });
});
