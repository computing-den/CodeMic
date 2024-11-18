import React from 'react';
import moment from 'moment';
import _ from 'lodash';

type Props = { timestamp: string; capitalize?: boolean };
export default class TimeFromNow extends React.Component<Props> {
  updateInterval: any;

  state = { text: this.calc() };

  update = () => {
    const text = this.calc();
    if (text !== this.state.text) this.setState({ text });
  };

  calc(): string {
    const text = moment(this.props.timestamp).fromNow();
    return this.props.capitalize ? _.capitalize(text) : text;
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
