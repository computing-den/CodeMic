import fs from 'fs';

let pid;
try {
  pid = Number(fs.readFileSync('.server.pid'));
  process.kill(pid);
} catch (error) {
  if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw error;
}
