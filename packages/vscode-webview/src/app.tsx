import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import postMessage from './api.js';
import Account from './account.jsx';
import Welcome from './welcome.jsx';
import Recorder from './recorder.jsx';
import Player from './player.jsx';
import Loading from './loading.jsx';

import _ from 'lodash';

type AppProps = {
  store: t.Store;
  // postMessage(req: t.FrontendRequest): Promise<t.BackendResponse>;
};

export default class App extends Component<AppProps> {
  onExit?: () => Promise<boolean>;

  openWelcome = async () => {
    await postMessage({ type: 'welcome/open' });
  };

  // openRecorder = async () => {
  //   await actions.openRecorder();
  // };

  // openPlayer = async (path: string) => {
  //   await actions.openPlayer();
  // };

  // exitScreen = async () => {
  //   if (!this.onExit || (await this.onExit())) {
  //     this.onExit = undefined;
  //     return true;
  //   }
  //   return false;
  // };

  // setOnExit = (onExit: () => Promise<boolean>) => {
  //   this.onExit = onExit;
  // };

  renderers = {
    [t.Screen.Account]: () => <Account user={this.props.store.user} account={this.props.store.account!} />,
    [t.Screen.Welcome]: () => <Welcome user={this.props.store.user} welcome={this.props.store.welcome!} />,
    [t.Screen.Recorder]: () => <Recorder user={this.props.store.user} recorder={this.props.store.recorder!} />,
    [t.Screen.Player]: () => <Player user={this.props.store.user} player={this.props.store.player!} />,
    [t.Screen.Loading]: () => <Loading />,
  };

  render() {
    return this.renderers[this.props.store.screen]();
  }
}

// class Breadcrumbs extends Component<BreadcrumbsProps> {
//   render() {
//     let elems = this.props.breadcrumbs.map(b =>
//       b.onClick ? (
//         <vscode-link href="#" onClick={b.onClick}>
//           <h2>{b.title}</h2>
//         </vscode-link>
//       ) : (
//         <h2>{b.title}</h2>
//       ),
//     );
//     elems = elems.flatMap((x, i) => (i ? [<span className="separator codicon codicon-chevron-right" />, x] : [x]));
//     return <div className="breadcrumbs">{elems}</div>;
//   }
// }
