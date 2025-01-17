import React from 'react';
import * as t from '../lib/types.js';
import Account from './account.jsx';
import Welcome from './welcome.jsx';
import Recorder from './recorder.jsx';
import Player from './player.jsx';
import Loading from './loading.jsx';
import { PopoverProvider } from './popover.jsx';
import { AppContextProvider } from './app_context.jsx';
import _ from 'lodash';

type AppProps = {
  store: t.Store;
};

export default function App({ store }: AppProps) {
  const renderers = {
    [t.Screen.Account]: (
      <Account user={store.user} account={store.account!} earlyAccessEmail={store.earlyAccessEmail} />
    ),
    [t.Screen.Welcome]: (
      <Welcome user={store.user} welcome={store.welcome!} earlyAccessEmail={store.earlyAccessEmail} />
    ),
    [t.Screen.Recorder]: <Recorder user={store.user} recorder={store.recorder!} session={store.session!} />,
    [t.Screen.Player]: <Player user={store.user} player={store.player!} session={store.session!} />,
    [t.Screen.Loading]: <Loading />,
  };

  return (
    <AppContextProvider store={store}>
      <PopoverProvider>{renderers[store.screen]}</PopoverProvider>
    </AppContextProvider>
  );
}
