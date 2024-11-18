import React from 'react';
import { cn } from './misc.js';

export type Props = {
  className?: string;
  component?: any;
  children: React.ReactNode;
};

export default class Wrap extends React.Component<Props> {
  render() {
    const { component, className, ...p } = this.props;
    const C = this.props.component ?? 'div';
    return (
      <C className={cn('wrap', className)} {...p}>
        {this.props.children}
      </C>
    );
  }
}
