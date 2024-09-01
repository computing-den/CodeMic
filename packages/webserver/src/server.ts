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
import unzipper from 'unzipper';

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
    CREATE TABLE IF NOT EXISTS session_heads (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      author TEXT,
      duration REAL,
      views INTEGER,
      likes INTEGER,
      publish_timestamp TEXT,
      modification_timestamp TEXT,
      forked_from TEXT,
      has_cover_photo INTEGER,
      toc TEXT
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
        await fs.promises.access(avatar, fs.constants.R_OK);
        res.sendFile(avatar, { maxAge });
      } catch (error) {
        console.error(error);
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

  app.get('/session', fillLocals, async (req, res, next) => {
    try {
      await handleDownloadSession(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.get('/session-cover-photo', fillLocals, async (req, res, next) => {
    try {
      await lib.timeout(3000);
      await handleDownloadSessionCoverPhoto(req, res);
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

      const dbSessionHeads = db
        .prepare(`SELECT * FROM session_heads WHERE author != ? ORDER BY likes DESC LIMIT 100`)
        .all(dbUser?.username) as t.DBSessionHead[];

      const sessionHeads = dbSessionHeadsToSessionHeads(dbSessionHeads);

      return {
        type: 'sessionHeads',
        sessionHeads,
      };
    }
    default:
      lib.unreachable(req);
  }
}

async function handlePublishSession(body: any, file: Express.Multer.File, locals: MyLocals): Promise<t.SessionHead> {
  const { dbUser } = locals;
  assert(dbUser);

  const sessionHead = JSON.parse(body.sessionHead) as t.SessionHead;
  console.log('sessionHead:', sessionHead);
  console.log('dbUser: ', locals.dbUser);

  if (!sessionHead.id) {
    throw new ServerError('Missing session ID.', 400);
  }
  // if (sessionHead.author.username !== locals.dbUser.username) {
  //   throw new ServerError('Forbidden: trying to publish as a different user.', 403);
  // }

  // sessionHead.id is picked by user and must be checked to make sure it doesn't
  // belong to another user.
  let dbSessionHead = db.prepare(`SELECT * from session_heads where id = ?`).get(sessionHead.id) as
    | t.DBSessionHead
    | undefined;
  if (dbSessionHead && dbSessionHead.author !== dbUser.username) {
    throw new ServerError('Forbidden: this session does not belong to you.', 403);
  }

  // Store session file named
  const sessionPath = path.resolve(config.data, 'sessions', dbUser.username, `${sessionHead.id}.zip`);
  await fs.promises.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.promises.copyFile(file.path, sessionPath);

  // Store cover photo
  if (sessionHead.hasCoverPhoto) {
    const coverPhotoPath = path.resolve(config.data, 'sessions_cover_photos', sessionHead.id);
    await fs.promises.mkdir(path.dirname(coverPhotoPath), { recursive: true });
    const directory = await unzipper.Open.file(sessionPath);
    const file = directory.files.find(d => d.path === 'cover_photo');
    if (!file) throw new ServerError('Cover photo not found', 400);
    await new Promise<void>((resolve, reject) => {
      file.stream().pipe(fs.createWriteStream(coverPhotoPath)).on('error', reject).on('finish', resolve);
    });
  }

  const now = new Date().toISOString();

  dbSessionHead = {
    id: sessionHead.id,
    title: sessionHead.title ?? '',
    description: sessionHead.description ?? '',
    author: dbUser.username,
    duration: sessionHead.duration,
    views: dbSessionHead?.views ?? 0,
    likes: dbSessionHead?.likes ?? 0,
    forked_from: sessionHead.forkedFrom,
    publish_timestamp: dbSessionHead?.publish_timestamp ?? now,
    modification_timestamp: dbSessionHead?.modification_timestamp ?? now,
    has_cover_photo: sessionHead.hasCoverPhoto ? 1 : 0,
    toc: JSON.stringify(sessionHead.toc),
  };

  db.prepare(
    `
      INSERT OR REPLACE INTO session_heads
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
        modification_timestamp,
        has_cover_photo,
        toc
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
        :modification_timestamp,
        :has_cover_photo,
        :toc
      )`,
  ).run(dbSessionHead);

  return fetchSessionHead(sessionHead.id);
}

async function handleDownloadSession(req: express.Request, res: express.Response) {
  // const { dbUser } = res.locals;
  const { id } = req.query;
  if (!id) throw new ServerError('Missing session id', 400);
  assertIsId(id);
  const author = db.prepare(`SELECT author FROM session_heads WHERE id = ?`).pluck().get(id) as string;
  if (!author) throw new ServerError('Session not found', 404);

  await serveFile(res, path.resolve(config.data, 'sessions', author, `${id}.zip`));
}

async function handleDownloadSessionCoverPhoto(req: express.Request, res: express.Response) {
  const { id } = req.query;
  if (!id) throw new ServerError('Missing session id', 400);
  assertIsId(id);

  await serveFile(res, path.resolve(config.data, 'sessions_cover_photos', id));
}

async function serveFile(res: express.Response, p: string) {
  await new Promise((resolve, reject) => {
    res.sendFile(p, error => {
      if (error) reject(error);
      else resolve(null);
    });
  });
}

function fetchSessionHead(id: string): t.SessionHead {
  const dbSessionHead = db.prepare(`SELECT * FROM session_heads WHERE id = ?`).get(id) as t.DBSessionHead;
  return dbSessionHeadToSessionHead(dbSessionHead);
}

function dbSessionHeadsToSessionHeads(dbSessionHeads: t.DBSessionHead[]): t.SessionHead[] {
  const authors = fetchUserSummaries(dbSessionHeads.map(s => s.author));
  const pairs = _.zip(dbSessionHeads, authors);

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
      toc: JSON.parse(s.toc),
      hasCoverPhoto: s.has_cover_photo === 1,
    };
  });
}

function dbSessionHeadToSessionHead(dbSessionHead: t.DBSessionHead): t.SessionHead {
  return dbSessionHeadsToSessionHeads([dbSessionHead])[0];
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

function assertIsId(id: any): asserts id is string {
  assert(typeof id === 'string' && !/[^a-z0-9-]/.test(id), `invalid id: ${id}`);
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
  constructor(
    message: string,
    public code: number,
  ) {
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
