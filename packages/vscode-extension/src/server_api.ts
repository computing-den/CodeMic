import config from './config.js';
import axios, { AxiosError } from 'axios';
import { types as t, path } from '@codecast/lib';
import fs from 'fs';
import FormData from 'form-data'; // native FormData does not support appending streams

export async function send<Req extends t.BackendToServerRequest>(req: Req): Promise<t.ServerResponseFor<Req>> {
  try {
    return (await axios.post(`${config.server}/api`, req)).data;
  } catch (error) {
    handleAxiosError(req, error as Error);
  }
}

export async function publish(filePath: t.AbsPath): Promise<string> {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    return (
      await axios.post(`${config.server}/publish`, form, {
        // Set boundary in the header field 'Content-Type' by calling method `getHeaders`
        headers: form.getHeaders(),
      })
    ).data;
  } catch (error) {
    handleAxiosError('uploading files', error as Error);
  }
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
