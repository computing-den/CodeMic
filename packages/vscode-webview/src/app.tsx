import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import postMessage from './api.js';
import Welcome from './welcome.jsx';
import Recorder from './recorder.jsx';
import Player from './player.jsx';

import _ from 'lodash';

type AppProps = {
  store: t.Store;
  // postMessage(req: t.FrontendRequest): Promise<t.BackendResponse>;
};

export default class App extends Component<AppProps> {
  onExit?: () => Promise<boolean>;

  openWelcome = async () => {
    await postMessage({ type: 'openWelcome' });
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
    [t.Screen.Welcome]: () => <Welcome welcome={this.props.store.welcome!} />,
    [t.Screen.Recorder]: () => <Recorder recorder={this.props.store.recorder!} />,
    [t.Screen.Player]: () => <Player player={this.props.store.player!} />,
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
