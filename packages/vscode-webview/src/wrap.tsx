import { h, Fragment, Component, JSX } from 'preact';
import { cn } from './misc.js';

export type Props = {
  className?: string;
  component?: any;
};

export default class Wrap extends Component<Props> {
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
