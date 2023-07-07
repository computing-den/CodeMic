import { h, render, Component } from 'preact';
import * as ui from './lib/ui';

export class App extends Component {
  interval: any;

  state = {
    time: 0,
    duration: 60,
    isPlaying: false,
  };

  sliderChanged = (e: Event) => {
    const time = Number((e.target as HTMLInputElement).value);
    this.setState({ time });
    postMessage({ type: 'seek', time });
  };

  play = () => {
    this.setState({ isPlaying: true });
    postMessage({ type: 'play' });

    // Fake playback events
    const TS = 0.2;
    this.interval = setInterval(() => {
      const time = Math.min(this.state.duration, this.state.time + TS);
      this.setState({ time });
      postMessage({ type: 'playbackUpdate', time });
      if (time >= this.state.duration) {
        this.stop();
      }
    }, TS * 1000);
  };

  stop = () => {
    this.setState({ isPlaying: false });
    postMessage({ type: 'stop' });
    clearInterval(this.interval);
    this.interval = undefined;
  };

  render = () => {
    const { time, duration, isPlaying } = this.state;
    return (
      <div>
        <input type="range" min={0} max={duration} step="any" onChange={this.sliderChanged} value={time} />
        <button className="button" onClick={this.play} disabled={isPlaying}>
          play
        </button>
        <button className="button" onClick={this.stop} disabled={!isPlaying}>
          stop
        </button>
      </div>
    );
  };
}

render(<App />, document.getElementById('app')!);

const vscode = acquireVsCodeApi();
// const oldState = vscode.getState() || { colors: [] };
// vscode.setState({ colors: colors });

window.addEventListener('message', event => {
  receivedMessage(event.data as ui.Event);
});

function postMessage(e: ui.Event) {
  vscode.postMessage(e);
}

function receivedMessage(e: ui.Event) {
  console.log('webview received: ', e);
}
