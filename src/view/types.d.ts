// // Must import 'preact' first so that we can augment its types instead of replacing them.
// // See https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation
// import 'react';
// declare module 'react' {
//   namespace JSX {
//     interface IntrinsicElements {
//       'vscode-button': any;
//       'vscode-link': any;
//       'vscode-badge': any;
//       'vscode-button': any;
//       'vscode-checkbox': any;
//       'vscode-data-grid': any;
//       'vscode-divider': any;
//       'vscode-dropdown': any;
//       'vscode-link': any;
//       'vscode-option': any;
//       'vscode-panels': any;
//       'vscode-panel-tab': any;
//       'vscode-panel-view': any;
//       'vscode-progress-ring': any;
//       'vscode-radio': any;
//       'vscode-radio-group': any;
//       'vscode-tag': any;
//       'vscode-text-area': any;
//       'vscode-text-field': any;
//     }
//   }
// }

// interface HTMLElement {
//   requestPictureInPicture?: () => Promise<PictureInPictureWindow>;
// }

// interface Document {
//   pictureInPictureElement?: HTMLElement;
//   exitPictureInPicture?: () => Promise<void>;
// }

// interface PictureInPictureWindow extends EventTarget {
//   readonly width: number;
//   readonly height: number;
//   onresize: ((this: PictureInPictureWindow, ev: Event) => any) | null;
// }
