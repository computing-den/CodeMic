import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import _ from 'lodash';
import config from './config.js';
import { types as t, assert } from '@codecast/lib';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import multer from 'multer';

const upload = multer({
  dest: path.join(os.tmpdir(), 'codecast'),
  limits: {
    fieldNameSize: 1000,
    fieldSize: 100 * 10 ** 6,
    files: 100,
  },
});

const ASSETS = path.join(process.cwd(), 'packages/webserver/src/assets');
const DIST = path.join(process.cwd(), 'packages/webclient/out');

const PASSWORD_LENGTH_MAX = 100;
const EMAIL_LENGTH_MAX = 250;
const USERNAME_LENGTH_MAX = 50;

let db: Database.Database;

start();

function start() {
  fs.writeFileSync('.server.pid', `${process.pid}`);
  initDB();
  initRoutes();
}

function initDB() {
  const dbPath = path.join(config.data, 'codecast.db');
  const dbLog = (...args: any[]) => {
    console.log('sqlite: ', ...args);
  };

  db = new Database(dbPath, { verbose: dbLog });
  db.pragma('journal_mode = WAL');

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      hash TEXT,
      email TEXT,
      token TEXT,
      join_timestamp TEXT,
      token_timestamp TEXT
    )`,
  ).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS index_users_email on users (email)`).run();

  return db;
}

function initRoutes() {
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

  app.post('/publish', upload.single('file'), async (req, res, next) => {
    try {
      console.log('file:', req.file);
      console.log('body:', req.body);

      const sessionSummary = JSON.parse(req.body.sessionSummary);
      console.log('sessionSummary:', sessionSummary);
      sessionSummary.published = true;

      res.send(sessionSummary);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, req: any, res: any, next: any) => {
    console.error(error);
    res.status(500).send(error.message);
  });
}

//==================================================
// Request handlers
//==================================================

async function handleRequest<Req extends t.BackendToServerRequest>(req: Req): Promise<t.ServerResponseFor<Req>> {
  switch (req.type) {
    case 'account/join': {
      let { email, password, username } = req.credentials;
      email = _.toLower(_.trim(email));
      username = _.toLower(_.trim(username));
      if (!username) {
        throw new Error('Missing username.');
      }
      if (username.length > USERNAME_LENGTH_MAX) {
        throw new Error(`Username must be at most ${USERNAME_LENGTH_MAX} characters`);
      }
      if (/[^a-zA-Z0-9_]/.test(username)) {
        throw new Error('Username can only contain a-z, A-Z, 0-9, and _.');
      }
      if (!email) {
        throw new Error('Missing email.');
      }
      if (email.length > EMAIL_LENGTH_MAX) {
        throw new Error(`Email must be at most ${EMAIL_LENGTH_MAX} characters`);
      }
      if (!password) {
        throw new Error('Missing password.');
      }
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password.length > PASSWORD_LENGTH_MAX) {
        throw new Error(`Password must be at most ${PASSWORD_LENGTH_MAX} characters`);
      }

      const usernameExists = db.prepare(`SELECT 1 from users where username = ?`).pluck().get(username);
      if (usernameExists) {
        throw new Error('Username already exists.');
      }

      // const emailExists = db.prepare(`SELECT 1 from users where email = ?`).pluck().get(email);
      // if (emailExists) {
      //   throw new Error('Email already exists.');
      // }

      const hash = await hashPassword(username, password);
      const token = createToken();
      const now = new Date().toISOString();
      db.prepare(
        `
          INSERT INTO users
          (username, hash, email, token, join_timestamp, token_timestamp)
          VALUES
          (?, ?, ?, ?, ?, ?)`,
      ).run(username, hash, email, token, now, now);

      return { type: 'user', user: { email, username, token, joinTimestamp: now, tokenTimestamp: now } };
    }
    case 'account/login': {
      let { password, username } = req.credentials;
      // email = _.toLower(_.trim(email));
      username = _.toLower(_.trim(username));
      if (!username) {
        throw new Error('Missing username.');
      }
      if (username.length > USERNAME_LENGTH_MAX) {
        throw new Error(`Username must be at most ${USERNAME_LENGTH_MAX} characters`);
      }
      if (!password) {
        throw new Error('Missing password.');
      }
      if (password.length > PASSWORD_LENGTH_MAX) {
        throw new Error(`Password must be at most ${PASSWORD_LENGTH_MAX} characters`);
      }

      const dbUser = db.prepare(`SELECT * from users where username = ?`).get(username) as t.DBUser | undefined;
      if (!dbUser) {
        throw new Error('Username does not exist.');
      }

      const hash = await hashPassword(username, password);
      if (dbUser.hash !== hash) {
        throw new Error('Wrong password.');
      }

      return {
        type: 'user',
        user: {
          username,
          email: dbUser.email,
          token: dbUser.token,
          joinTimestamp: dbUser.join_timestamp,
          tokenTimestamp: dbUser.token_timestamp,
        },
      };
    }
  }
}

async function hashPassword(username: string, password: string) {
  // Add salt based on the username.
  const salted = username + password + String(username.length * 131 + 530982758);
  return computeSHA1(new TextEncoder().encode(salted));
}

export async function computeSHA1(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function createToken(): string {
  return Array.from(crypto.randomBytes(64))
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}
