import { ENGINE, ENGINE_VERSION } from './engine.gen.js';
import { handle } from './api.js';

export default {
  fetch: (request, env) => handle(request, env, { E: ENGINE, VERSION: ENGINE_VERSION }),
};
