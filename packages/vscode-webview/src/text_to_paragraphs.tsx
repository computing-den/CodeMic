import { h, Fragment, Component } from 'preact';

type Props = { text: string };
export default class TextToParagraphs extends Component<Props> {
  updateInterval: any;

  render() {
    return (
      <>
        {this.props.text
          .split('\n')
          .map(x => x.trim())
          .filter(Boolean)
          .map(x => (
            <p>{x}</p>
          ))}
      </>
    );
  }
}
