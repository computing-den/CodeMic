import config from './config.js';
import fetch from 'node-fetch';
import { types as t } from '@codecast/lib';

export async function send<Req extends t.BackendToServerRequest>(req: Req): Promise<t.ServerResponseFor<Req>> {
  const response = await fetch(`${config.server}/api`, {
    method: 'post',
    body: JSON.stringify(req),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  const json = (await response.json()) as t.ServerResponseFor<Req> | t.ErrorResponse;

  if (json.type === 'error') {
    throw new Error(json.message ?? `Got error for request ${JSON.stringify(req)}`);
  }

  return json;
}
