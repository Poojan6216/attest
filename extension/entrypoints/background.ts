import { defineBackground } from 'wxt/utils/define-background';

import { log } from '../src/log';

// Thin entrypoint (extension_engineer rule: business logic never lives here).
// MV3: every listener must be registered synchronously inside main().
export default defineBackground({
  type: 'module',
  main() {
    log.info('background.started');
  },
});
