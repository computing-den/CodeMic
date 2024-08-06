import fs from 'fs';
import path from 'path';

export type Config = {
  server: string;
  logRecorderAcceptedVscEvents: boolean;
  logRecorderRawVscEvents: boolean;
  logSessionTracksCtrlUpdateStep: boolean;
  logTrackPlayerUpdateStep: boolean;
};

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')) as Config;

export default config;
