import buildKey from '../.turingpot/build-key.js';
import { inventory } from './inventory.js';

export default {
  fetch(request, env) {
    return inventory(request, {
      secret: env.TURINGPOT_KEY ?? buildKey,
      sourceIp: request.headers.get('cf-connecting-ip'),
      ja4: request.cf?.botManagement?.ja4,
    });
  },
};
