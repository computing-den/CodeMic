import { h, Fragment, Component } from 'preact';
import moment from 'moment';

type Props = { timestamp: string };
export default class TimeFromNow extends Component<Props> {
  updateInterval: any;

  state = { text: this.calc() };

  update = () => {
    const text = this.calc();
    if (text !== this.state.text) this.setState({ text });
  };

  calc(): string {
    return moment(this.props.timestamp).fromNow();
  }

  componentDidMount() {
    this.updateInterval = setInterval(this.update, 60 * 1000);
  }

  componentWillUnmount() {
    this.updateInterval = clearInterval(this.updateInterval);
  }

  render() {
    return this.state.text;
  }
}
