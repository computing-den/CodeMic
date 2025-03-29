import fs from 'fs';
import path from 'path';

export type Config = {
  server: string;
  logWebviewVideoEvents: boolean;
  logBackendVideoEvents: boolean;
  logWebviewAudioEvents: boolean;
  logBackendAudioEvents: boolean;
  logRecorderAcceptedVscEvents: boolean;
  logRecorderRawVscEvents: boolean;
  logSessionRRUpdateStep: boolean;
  logTrackPlayerUpdateStep: boolean;
  logMasterAndTracksTimeUpdates: boolean;
  debug: boolean;
};

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')) as Config;

export default config;
