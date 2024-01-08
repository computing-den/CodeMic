import config from './config.js';
import axios, { AxiosError } from 'axios';
import { types as t, path } from '@codecast/lib';
import fs from 'fs';
import FormData from 'form-data'; // native FormData does not support appending streams
import * as vscode from 'vscode';
import stream from 'stream';

export async function send<Req extends t.BackendToServerRequest>(
  req: Req,
  token?: string,
): Promise<t.ExtractResponse<t.BackendToServerReqRes, Req>> {
  try {
    return (await axios.post(getURLString('/api', { token }).toString(), req)).data;
  } catch (error) {
    handleAxiosError(req, error as Error);
  }
}

export async function publishSession(
  sessionSummary: t.SessionSummary,
  filePath: t.AbsPath,
  token?: string,
): Promise<t.SessionSummary> {
  try {
    const form = new FormData();
    form.append('sessionSummary', JSON.stringify(sessionSummary));
    form.append('file', fs.createReadStream(filePath));

    return (
      await axios.post(getURLString('/publish_session', { token }), form, {
        // Set boundary in the header field 'Content-Type' by calling method `getHeaders`
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
      })
    ).data;
  } catch (error) {
    handleAxiosError('publish_session', error as Error);
  }
}

export async function downloadSession(id: string, dst: t.AbsPath, token?: string) {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      cancellable: false,
      title: 'Downloading session',
    },
    async progress => {
      try {
        const res = await axios.get(getURLString('/download_session', { token, id }), {
          responseType: 'stream',
          maxContentLength: Infinity,
        });

        const contentLength = res.headers['Content-Length'];
        console.log('XXX: contentLength', typeof contentLength, contentLength);

        await fs.promises.mkdir(path.dirname(dst), { recursive: true });
        await stream.promises.pipeline(res.data, fs.createWriteStream(dst));
      } catch (error) {
        handleAxiosError('download_session', error as Error);
      }
    },
  );
}

function handleAxiosError(req: any, error: Error): never {
  console.error('Error for request ', JSON.stringify(req), error);
  if (error instanceof AxiosError && error.response) {
    console.error(error.response.data);
    throw new Error(error.response.data);
  } else {
    throw new Error(error.message);
  }
}

function getURLString(pathname: string, paramsObj: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(paramsObj)) {
    if (value !== undefined) params.append(key, value);
  }
  return `${config.server}${pathname}?${params.toString()}`;
}
