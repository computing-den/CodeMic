// Must import 'preact' first so that we can augment its types instead of replacing them.
// See https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation
import 'preact';
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'vscode-button': any;
      'vscode-link': any;
      badge: any;
      button: any;
      checkbox: any;
      'data-grid': any;
      divider: any;
      dropdown: any;
      link: any;
      option: any;
      panels: any;
      'progress-ring': any;
      radio: any;
      'radio-group': any;
      tag: any;
      'text-area': any;
      'text-field': any;
    }
  }
}
