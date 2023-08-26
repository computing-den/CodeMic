import { h, Fragment, Component } from 'preact';
import { types as t, lib } from '@codecast/lib';
import * as actions from './actions.js';
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
    await actions.openWelcome();
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

  screens = {
    [t.Screen.Welcome]: Welcome,
    [t.Screen.Recorder]: Recorder,
    [t.Screen.Player]: Player,
  };

  render() {
    const Screen = this.screens[this.props.store.screen];
    return (
      <Screen
        {...this.props}
        onExit={this.openWelcome}
        // setOnExit={this.setOnExit}
      />
    );
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
