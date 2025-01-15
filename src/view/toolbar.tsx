import React, { forwardRef, Ref, useRef, useState } from 'react';
import { cn } from './misc.js';
import { useClickOutsideHandler } from './hooks.js';
import _ from 'lodash';
import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';

type ToolbarProps = { actions: React.ReactNode[] };

const Toolbar = forwardRef(function Toolbar(props: ToolbarProps, ref: Ref<any>) {
  return (
    <div ref={ref} className="toolbar">
      {props.actions}
    </div>
  );
});

function ToolbarSeparator() {
  return <div className="separator-line" />;
}

type ToolbarButtonProps = { title: string; onClick?: () => any; icon: string; disabled?: boolean };
const ToolbarButton = forwardRef(function ToolbarButton(props: ToolbarButtonProps, ref: React.Ref<any>) {
  return (
    <VSCodeButton
      ref={ref}
      appearance="icon"
      title={props.title}
      onClick={props.onClick}
      disabled={Boolean(props.disabled)}
    >
      {props.icon && <span className={cn(props.icon)} />}
    </VSCodeButton>
  );
});

// function ToolbarButtonWithOverlay(props: {
//   title: string;
//   icon: string;
//   overlay: React.ReactNode;
//   disabled?: boolean;
// }) {
//   const triggerRef = useRef(null);
//   const popover = usePopover({ triggerRef, placement: 'below', content: props.popover });
//   return (
//     <VSCodeButton
//       ref={triggerRef}
//       appearance="icon"
//       title={props.title}
//       onClick={props.popover ? () => setIsOpen(!isOpen) : props.onClick}
//       disabled={Boolean(props.disabled)}
//     >
//       {props.icon && <span className={cn(props.icon)} />}
//       {props.label}
//     </VSCodeButton>
//   );
// }

export default Object.assign(Toolbar, { Separator: ToolbarSeparator, Button: ToolbarButton });
// Toolbar.Separator = ToolbarSeparator;
// Toolbar.Button = ToolbarButton;
// // Toolbar.ButtonWithOverlay = ToolbarButtonWithOverlay;

// export default Toolbar;
