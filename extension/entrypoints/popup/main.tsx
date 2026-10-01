import { render } from 'preact';

import '../../src/ui/tailwind.css';
import { App } from './App';

const root = document.getElementById('app');
if (root) render(<App />, root);
