import express from 'express';
import path from 'path';
import fs from 'fs';
import _ from 'lodash';
import config from './config.js';
import { types as t, assert } from '@codecast/lib';

const ASSETS = path.join(process.cwd(), 'packages/webserver/src/assets');
const DIST = path.join(process.cwd(), 'packages/webclient/out');
const app = express();

app.use(express.json());

app.listen(config.port, () => {
  console.log(`Listening on port ${config.port}`);
});

app.use('/assets', express.static(ASSETS));
app.use('/dist', express.static(DIST));

app.get('/', (req, res) => {
  res.sendFile(path.join(ASSETS, 'index.html'));
});

app.post('/api', async (req, res, next) => {
  try {
    res.send(await handleRequest(req.body as t.BackendToServerRequest));
  } catch (error) {
    next(error);
  }
});

app.use((error: Error, req: any, res: any, next: any) => {
  console.error(error);
  res.status(500).send(error.message);
});

fs.writeFileSync('.server.pid', `${process.pid}`);

//==================================================
// Request handlers
//==================================================

async function handleRequest<Req extends t.BackendToServerRequest>(req: Req): Promise<t.ServerResponseFor<Req>> {
  switch (req.type) {
    case 'account/join': {
      let { email, password, username } = req.credentials;
      email = _.toLower(_.trim(email));
      username = _.toLower(_.trim(username));
      if (!email) {
        throw new Error('Missing email.');
      } else if (!username) {
        throw new Error('Missing username.');
      } else if (!password) {
        throw new Error('Missing password.');
      } else if (email === 'a') {
        throw new Error('Email is already registered.');
      } else if (username === 'a') {
        throw new Error('Username is already registered.');
      }

      return { type: 'user', user: { email, username, token: 'aaa' } };
    }
    case 'account/login': {
      let { email, password, username } = req.credentials;
      email = _.toLower(_.trim(email));
      username = _.toLower(_.trim(username));
      if (!username) {
        throw new Error('Missing username.');
      } else if (!password) {
        throw new Error('Missing password.');
      } else if (username === 'a' && password === 'a') {
        return { type: 'user', user: { email: 'sean@computing-den.com', token: 'aaa', username: 'sean_shir' } };
      } else {
        throw new Error('Wrong username or password.');
      }
    }
  }
}
