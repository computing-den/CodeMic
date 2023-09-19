import { h, Fragment, Component } from 'preact';

type Props = { className?: string };
export default class Screen extends Component<Props> {
  render() {
    return <div className={`screen ${this.props.className || ''}`}>{this.props.children}</div>;
  }
}
