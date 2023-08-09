import { h, Fragment, Component } from 'preact';

// type HeaderProps = { title: string; onExit: () => void };
// class Header extends Component<HeaderProps> {
//   render() {
//     return (
//       <div className="header">
//         <h3 className="title">{this.props.title}</h3>
//         <div className="actions">
//           <vscode-button appearance="icon" title="Exit">
//             <span className="codicon codicon-close" />
//           </vscode-button>
//         </div>
//       </div>
//     );
//   }
// }

// class Body extends Component {
//   render() {
//     return <div className="body">{this.props.children}</div>;
//   }
// }

type Props = { className?: string };
export default class Screen extends Component<Props> {
  // static Header = Header;
  // static Body = Body;

  render() {
    return <div className={`screen ${this.props.className || ''}`}>{this.props.children}</div>;
  }
}
