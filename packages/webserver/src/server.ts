import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import _ from 'lodash';
import config from './config.js';
import { types as t, assert, lib } from '@codecast/lib';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import multer from 'multer';
import stream from 'stream';
import { v4 as uuid } from 'uuid';

const upload = multer({
  dest: path.resolve(os.tmpdir(), 'codecast'),
  limits: {
    fieldNameSize: 1000,
    fieldSize: 100 * 10 ** 6,
    files: 100,
  },
});

const ASSETS = path.resolve(process.cwd(), 'packages/webserver/src/assets');
const DIST = path.resolve(process.cwd(), 'packages/webclient/out');

const PASSWORD_LENGTH_MIN = 8;
const PASSWORD_LENGTH_MAX = 100;
const EMAIL_LENGTH_MAX = 250;
const USERNAME_LENGTH_MIN = 3;
const USERNAME_LENGTH_MAX = 50;

let db: Database.Database;

start();

function start() {
  fs.writeFileSync('.server.pid', `${process.pid}`);
  initDB();
  initRoutes();
}

function initDB() {
  const dbPath = path.resolve(config.data, 'codecast.db');
  function dbLog(...args: any[]) {
    console.log('sqlite: ', ...args);
  }

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
  db.prepare(`CREATE INDEX IF NOT EXISTS index_users_token on users (token)`).run();

  db.prepare(
    `
    CREATE TABLE IF NOT EXISTS session_summaries (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      author TEXT,
      duration REAL,
      views INTEGER,
      likes INTEGER,
      publish_timestamp TEXT,
      modification_timestamp TEXT,
      forked_from TEXT
    )`,
  ).run();

  return db;
}

function initRoutes() {
  const app = express();

  app.use(requestLogger);

  app.use(express.json());

  app.listen(config.port, () => {
    console.log(`Listening on port ${config.port}`);
  });

  app.use('/assets', express.static(ASSETS));
  app.use('/dist', express.static(DIST));
  app.get('/avatars/:username', async (req, res, next) => {
    try {
      const maxAge = 24 * 3600 * 1000;
      const avatar = path.resolve(config.data, 'avatars', req.params.username);
      try {
        console.log('XXX a');
        await fs.promises.access(avatar, fs.constants.R_OK);
        console.log('XXX b');
        res.sendFile(avatar, { maxAge });
      } catch (error) {
        console.error(error);
        console.log('XXX c');
        res.sendFile(path.resolve(ASSETS, 'default-avatar.png'));
      }
    } catch (error) {
      next(error);
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.resolve(ASSETS, 'index.html'));
  });

  app.post('/api', fillLocals, async (req, res, next) => {
    try {
      res.send(await handleRequest(req.body as t.BackendToServerRequest, res.locals));
    } catch (error) {
      next(error);
    }
  });

  app.post('/publish_session', fillLocals, authenticate, upload.single('file'), async (req, res, next) => {
    try {
      assert(req.file, '/publish_session expects a zip file to be uploaded.');
      res.send(await handlePublishSession(req.body, req.file, res.locals));
    } catch (error) {
      next(error);
    }
  });

  app.get('/session', fillLocals, upload.single('file'), async (req, res, next) => {
    try {
      await handleDownloadSession(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, req: any, res: any, next: any) => {
    console.error(error);
    let code = 500;
    if (error instanceof ServerError) {
      code = error.code;
    }
    res.status(code).send(error.message);
  });
}

//==================================================
// End of express routes
//==================================================

async function handleRequest(req: t.BackendToServerRequest, locals: MyLocals): Promise<t.ServerResponse> {
  switch (req.type) {
    case 'account/join': {
      let { email, password, username } = req.credentials;
      email = _.toLower(_.trim(email));
      username = _.toLower(_.trim(username));
      if (!username) {
        throw new Error('Missing username.');
      }
      if (username.length < USERNAME_LENGTH_MIN) {
        throw new Error(`Username must be at least ${USERNAME_LENGTH_MIN} characters`);
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
      if (password.length < PASSWORD_LENGTH_MIN) {
        throw new Error(`Password must be at least ${PASSWORD_LENGTH_MIN} characters`);
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
    case 'featured/get': {
      const { dbUser } = locals;

      const dbSessionSummaries = db
        .prepare(`SELECT * FROM session_summaries WHERE author != ? ORDER BY likes DESC LIMIT 100`)
        .all(dbUser?.username) as t.DBSessionSummary[];

      const sessionSummaries = dbSessionSummariesToSessionSummaries(dbSessionSummaries);

      return {
        type: 'sessionSummaries',
        sessionSummaries,
      };
    }
    default:
      lib.unreachable(req);
  }
}

async function handlePublishSession(body: any, file: Express.Multer.File, locals: MyLocals): Promise<t.SessionSummary> {
  const { dbUser } = locals;
  assert(dbUser);

  const sessionSummary = JSON.parse(body.sessionSummary) as t.SessionSummary;
  console.log('sessionSummary:', sessionSummary);
  console.log('dbUser: ', locals.dbUser);

  if (!sessionSummary.id) {
    throw new ServerError('Missing session ID.', 400);
  }
  // if (sessionSummary.author.username !== locals.dbUser.username) {
  //   throw new ServerError('Forbidden: trying to publish as a different user.', 403);
  // }

  // sessionSummary.id is picked by user and must be checked to make sure it doesn't
  // belong to another user.
  let dbSessionSummary = db.prepare(`SELECT * from session_summaries where id = ?`).get(sessionSummary.id) as
    | t.DBSessionSummary
    | undefined;
  if (dbSessionSummary && dbSessionSummary.author !== dbUser.username) {
    throw new ServerError('Forbidden: this session does not belong to you.', 403);
  }

  // Store session file named
  const sessionPath = path.resolve(config.data, 'sessions', dbUser.username, `${sessionSummary.id}.zip`);
  await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.promises.copyFile(file.path, sessionPath);

  const now = new Date().toISOString();

  dbSessionSummary = {
    id: sessionSummary.id,
    title: sessionSummary.title ?? '',
    description: sessionSummary.description ?? '',
    author: dbUser.username,
    duration: sessionSummary.duration,
    views: dbSessionSummary?.views ?? 0,
    likes: dbSessionSummary?.likes ?? 0,
    forked_from: sessionSummary.forkedFrom,
    publish_timestamp: dbSessionSummary?.publish_timestamp ?? now,
    modification_timestamp: dbSessionSummary?.modification_timestamp ?? now,
  };

  db.prepare(
    `
      INSERT OR REPLACE INTO session_summaries
      (
        id,
        title,
        description,
        author,
        duration,
        views,
        likes,
        forked_from,
        publish_timestamp,
        modification_timestamp
      )
      VALUES
      (
        :id,
        :title,
        :description,
        :author,
        :duration,
        :views,
        :likes,
        :forked_from,
        :publish_timestamp,
        :modification_timestamp
      )`,
  ).run(dbSessionSummary);

  return fetchSessionSummary(sessionSummary.id);
}

async function handleDownloadSession(req: express.Request, res: express.Response) {
  // const { dbUser } = res.locals;
  const { id } = req.query;
  if (!id) throw new ServerError('Missing session id', 400);
  const author = db.prepare(`SELECT author FROM session_summaries WHERE id = ?`).pluck().get(id) as string;
  if (!author) throw new ServerError('Session not found', 404);

  // sessionPath must be absolute because it'll be used for res.sendFile.
  const sessionPath = path.resolve(config.data, 'sessions', author, `${id}.zip`);
  await new Promise((resolve, reject) => {
    res.sendFile(sessionPath, error => {
      if (error) reject(error);
      else resolve(null);
    });
  });
}

function fetchSessionSummary(id: string): t.SessionSummary {
  const dbSessionSummary = db.prepare(`SELECT * FROM session_summaries WHERE id = ?`).get(id) as t.DBSessionSummary;
  return dbSessionSummaryToSessionSummary(dbSessionSummary);
}

function dbSessionSummariesToSessionSummaries(dbSessionSummaries: t.DBSessionSummary[]): t.SessionSummary[] {
  const authors = fetchUserSummaries(dbSessionSummaries.map(s => s.author));
  const pairs = _.zip(dbSessionSummaries, authors);

  return pairs.map(([s, author]) => {
    assert(s);
    assert(author);
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      author,
      duration: s.duration,
      views: s.views,
      likes: s.likes,
      publishTimestamp: s.publish_timestamp,
      modificationTimestamp: s.modification_timestamp,
      forkedFrom: s.forked_from,
      toc: [],
    };
  });
}

function dbSessionSummaryToSessionSummary(dbSessionSummary: t.DBSessionSummary): t.SessionSummary {
  return dbSessionSummariesToSessionSummaries([dbSessionSummary])[0];
}

function fetchUserSummaries(usernames: string[]): t.UserSummary[] {
  const dbUsers = db
    .prepare(`SELECT * FROM users WHERE username IN (${_.times(usernames.length, () => '?').join(',')})`)
    .all(usernames) as t.DBUser[];
  assert(dbUsers.length === usernames.length);
  const dbUsersMap = _.keyBy(dbUsers, 'username');
  return usernames.map(username => lib.dbUserToUserSummary(dbUsersMap[username]));
}

async function fillLocals(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.query.token) {
    const dbUser = db.prepare(`SELECT * from users where token = ?`).get(req.query.token) as t.DBUser | undefined;
    res.locals = { dbUser };
  }
  next();
}

async function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!res.locals.dbUser) {
    next(new ServerError('Forbidden', 403));
  } else {
    next();
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

export default function requestLogger(req: express.Request, res: express.Response, next: express.NextFunction) {
  const startTime = Date.now();

  const logRequest = () => {
    console.log({
      // '%s - [%d ms] - %s - %s - %s',
      // timestampISO: new Date().toISOString(),
      responseTime: (Date.now() - startTime) / 1000,
      method: req.method,
      ip: req.ip || req.connection?.remoteAddress,
      url: req.originalUrl || req.url,
      query: req.query,
      status: res.statusCode,
      contentLength: res.getHeader('content-length'),
      userAgent: req.headers['user-agent'],
      locals: res.locals,
    });
  };

  res.on('close', logRequest);

  next();
}

class ServerError extends Error {
  constructor(message: string, public code: number) {
    super(message);
  }
}

interface MyLocals {
  dbUser?: t.DBUser;
}

declare module 'express' {
  export interface Response {
    locals: MyLocals;
  }
}
