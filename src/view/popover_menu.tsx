import { cn } from './misc.js';
import React, { ReactNode } from 'react';
import Popover, { PopoverProps } from './popover.jsx';
import _ from 'lodash';

export type PopoverMenuItem = {
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  title: string;
  active?: boolean;
  closeOnClick?: boolean;
};

export default function PopoverMenu(props: PopoverProps & { items: PopoverMenuItem[]; hints?: string[] }) {
  return (
    <Popover {...props} className={cn(props.className, 'popover-menu')}>
      {props.items.map((item, i) => (
        <MenuItemUI key={'item_' + i} {...item} close={props.popover.close} />
      ))}
      {props.hints?.map((hint, i) => (
        <MenuHintUI key={'hint_' + i} text={hint} />
      ))}
    </Popover>
  );
}

function MenuItemUI(props: PopoverMenuItem & { close: () => void }) {
  return (
    <a
      href="#"
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        if (!props.disabled) {
          props.onClick?.();
          if (props.closeOnClick !== false) {
            props.close();
          }
        }
      }}
      className={cn('unstyled item action', props.disabled && 'disabled', props.active && 'active')}
    >
      {_.isString(props.icon) ? <span className={props.icon} /> : props.icon ? props.icon : <span />}
      <span className="title">{props.title}</span>
    </a>
  );
}

function MenuHintUI(props: { text: string }) {
  return (
    <div className="item hint">
      <span className="codicon codicon-info" />
      <span className="title">{props.text}</span>
    </div>
  );
}
