import buildKey from '../.turingpot/build-key.js';
import { inventory } from '../src/inventory.js';

export default {
  fetch(request) {
    const url = new URL(request.url);
    const collection = url.searchParams.get('tp_collection');
    // Vercel can pass the rewritten function URL to the handler.
    const pathname = url.pathname === '/api/inventory' && collection
      ? '/api/' + collection : url.pathname;
    return inventory(request, {
      pathname,
      secret: process.env.TURINGPOT_KEY ?? buildKey,
      sourceIp: request.headers.get('x-vercel-forwarded-for')?.split(',')[0],
      ja4: request.headers.get('x-vercel-ja4-digest'),
      log: event => console.log(JSON.stringify(event)),
    });
  },
};
