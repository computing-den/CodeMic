import { types as t, lib } from '@codemic/lib';
import { h, Fragment, Component } from 'preact';
import postMessage from './api.js';
import _ from 'lodash';

type Props = { store: t.Store };
export default class LatencyTest extends Component<Props> {
  roundtripTimes = [] as number[];
  renderTimes = [] as number[];
  lastRenderTimestamp = performance.now();
  lastRenderedTestValue = 0;

  step = async () => {
    if (this.props.store.test < 5000) {
      const start = performance.now();
      await postMessage({ type: 'test', value: this.props.store.test + 1 });
      this.roundtripTimes.push(performance.now() - start);
    } else {
      summarize(this.renderTimes, 'renderTimes');
      summarize(this.roundtripTimes, 'roundtripTimes');
    }
  };

  async componentDidMount() {
    this.step();
  }

  render() {
    if (this.lastRenderedTestValue < this.props.store.test) {
      const now = performance.now();
      this.renderTimes.push(now - this.lastRenderTimestamp);
      this.lastRenderTimestamp = now;
      this.lastRenderedTestValue = this.props.store.test;
      this.step();
    }

    return <div>TEST: {this.props.store.test}</div>;
  }
}

function summarize(arr: number[], name: string) {
  arr = arr.slice(10); // ignore the first few because the timer may not have been set correctly
  const max = _.max(arr);
  const min = _.min(arr);
  const avg = _.sum(arr) / arr.length;
  console.log(`XXX ${name} max: ${max}, min: ${min}, avg: ${avg}, len: ${arr.length}`);
}
