import express from 'express';
import path from 'path';
import fs from 'fs';

const ASSETS = path.join(process.cwd(), 'packages/webserver/src/assets');
const DIST = path.join(process.cwd(), 'packages/webclient/out');
const port = 3000;
const app = express();

app.use(express.json());

app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

app.use('/assets', express.static(ASSETS));
app.use('/dist', express.static(DIST));

app.get('/', (req, res) => {
  res.sendFile(path.join(ASSETS, 'index.html'));
});

fs.writeFileSync('.server.pid', `${process.pid}`);
