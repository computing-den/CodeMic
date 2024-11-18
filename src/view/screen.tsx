import React from 'react';

type Props = { className?: string; children: React.ReactNode };
export default class Screen extends React.Component<Props> {
  componentDidMount() {
    window.scrollTo(0, 0);
  }
  render() {
    return <div className={`screen ${this.props.className || ''}`}>{this.props.children}</div>;
  }
}
