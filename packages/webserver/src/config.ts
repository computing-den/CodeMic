import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export type Config = {
  port: number;
  data: string;
};

const config = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json'), 'utf8'),
) as Config;

export default config;
