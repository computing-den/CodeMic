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

export default function PopoverMenu(props: PopoverProps & { items: PopoverMenuItem[] }) {
  return (
    <Popover {...props} className={cn(props.className, 'popover-menu')}>
      {props.items.map((item, i) => (
        <MenuItemUI key={i} {...item} close={props.popover.close} />
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
      className={cn('unstyled menu-item', props.disabled && 'disabled', props.active && 'active')}
    >
      {_.isString(props.icon) ? <span className={props.icon} /> : props.icon ? props.icon : <span />}
      <span className="title">{props.title}</span>
    </a>
  );
}
