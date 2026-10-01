import '../../src/setup';

import { render } from 'preact';

import '../../src/ui/tailwind.css';
import { log } from '../../src/log';
import { App } from './App';

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
} else {
  log.error('options.root_missing');
}
