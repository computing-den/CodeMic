import _ from 'lodash';
import type { WebviewConfig } from '../lib/types.js';

const config: WebviewConfig = JSON.parse(_.unescape(document.getElementById('config')!.innerHTML));

export default config;
