import { cn } from './misc.js';
import { h, Fragment, Component } from 'preact';

export type Props = {
  className?: string;
  onSeek: (clock: number) => unknown;
  duration: number;
  clock: number;
};

export default class ProgressBar extends Component<Props> {
  ref?: Element;

  setRef = (elem: Element | null) => {
    this.ref = elem || undefined;
  };

  clicked = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const clock = this.getClockOfMouse(e);
    this.props.onSeek(clock);
  };

  mouseMoved = (e: MouseEvent) => {
    if (this.isMouseOnProgressBar(e)) {
      const p = this.getPosNormOfMouse(e);
      const shadow = this.ref!.querySelector('.shadow') as HTMLElement;
      shadow.style.height = `${p * 100}%`;
    }
  };

  getClockOfMouse = (e: MouseEvent): number => {
    return this.props.duration * this.getPosNormOfMouse(e);
  };

  getPosNormOfMouse = (e: MouseEvent): number => {
    const rect = this.ref!.getBoundingClientRect();
    return (e.clientY - rect.y) / rect.height;
  };

  isMouseOnProgressBar = (e: MouseEvent): boolean => {
    if (!this.ref) return false;
    const rect = this.ref.getBoundingClientRect();
    const p = [e.clientX - rect.x, e.clientY - rect.y];
    return p[0] >= 0 && p[0] <= rect.width && p[1] >= 0 && p[1] <= rect.height;
  };

  componentDidMount() {
    document.addEventListener('mousemove', this.mouseMoved);
  }

  componentWillUnmount() {
    document.removeEventListener('mousemove', this.mouseMoved);
  }

  render() {
    const filledStyle = { height: `${(this.props.clock / this.props.duration) * 100}%` };

    return (
      <div className={cn('progress-bar', this.props.className)} ref={this.setRef} onClick={this.clicked}>
        <div className="bar">
          <div className="shadow" />
          <div className="filled" style={filledStyle} />
        </div>
      </div>
    );
  }
}
