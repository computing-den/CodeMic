import cache from './cache.js';
import config from './config.js';
import axios, { AxiosError } from 'axios';
import * as t from '../lib/types.js';
import * as storage from './storage.js';
import * as path from 'path';
import fs from 'fs';
import FormData from 'form-data'; // native FormData does not support appending streams
import * as vscode from 'vscode';
import stream from 'stream';
import { Progress } from './types.js';

export async function send<Req extends t.BackendToServerRequest>(
  req: Req,
  token?: string,
): Promise<t.ExtractResponse<t.BackendToServerReqRes, Req>> {
  try {
    return (await axios.post(getURLString('/api', { token }).toString(), req)).data;
  } catch (error) {
    handleAxiosError(JSON.stringify(req), error as Error);
  }
}

export async function publishSession(
  sessionHead: t.SessionHead,
  filePath: string,
  token?: string,
  progress?: Progress,
  abortController?: AbortController,
): Promise<t.SessionHead> {
  try {
    const form = new FormData();
    form.append('sessionHead', JSON.stringify(sessionHead));
    form.append('file', fs.createReadStream(filePath));

    let lastReportedProgress = 0;
    return (
      await axios.post(getURLString('/publish_session', { token }), form, {
        signal: abortController?.signal,
        // Set boundary in the header field 'Content-Type' by calling method `getHeaders`
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        onUploadProgress: e => {
          if (e.progress !== undefined) {
            progress?.report({ increment: (e.progress - lastReportedProgress) * 100 });
            lastReportedProgress = e.progress;
          }
        },
      })
    ).data;
  } catch (error) {
    handleAxiosError('publish session', error as Error);
  }
}

export async function downloadSessionBody(
  id: string,
  dst: string,
  token?: string,
  progress?: Progress,
  abortController?: AbortController,
) {
  try {
    let lastReportedProgress = 0;
    const res = await axios.get(getURLString('/session-body', { token, id }), {
      signal: abortController?.signal,
      responseType: 'stream',
      maxContentLength: Infinity,
      onDownloadProgress: e => {
        if (e.progress !== undefined) {
          progress?.report({ increment: (e.progress - lastReportedProgress) * 100 });
          lastReportedProgress = e.progress;
        }
      },
    });

    // const contentLength = res.headers['Content-Length'];
    // console.log('XXX: contentLength', typeof contentLength, contentLength);

    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await stream.promises.pipeline(res.data, fs.createWriteStream(dst));
    console.log('Downloaded session to', dst);
  } catch (error) {
    handleAxiosError('download session', error as Error);
  }
}

function handleAxiosError(label: string, error: Error): never {
  console.error('Error for request: ', label, error);
  if (error instanceof AxiosError && error.response) {
    console.error(error.response.data);
    throw new Error(error.response.data);
  } else {
    throw new Error(error.message);
  }
}

export async function downloadSessionCover(id: string) {
  const res = await axios.get(getURLString('/session-cover', { id }), { responseType: 'arraybuffer' });
  await cache.writeCover(id, res.data);
}

export async function downloadAvatar(username: string) {
  const res = await axios.get(getURLString('/avatar', { username }), { responseType: 'arraybuffer' });
  await cache.writeAvatar(username, res.data);
}

function getURLString(pathname: string, paramsObj: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(paramsObj)) {
    if (value !== undefined) params.append(key, value);
  }
  return `${config.server}${pathname}?${params.toString()}`;
}
