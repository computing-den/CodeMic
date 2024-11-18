import React from 'react';
import { cn } from './misc.js';
import _ from 'lodash';

export type Tab = {
  id: string;
  label: string;
};
export type TabChild = React.ReactElement<TabViewProps>;
export type TabViewProps = { id: string; className?: string; active?: boolean };
type Props = { tabs: Tab[]; activeTabId: string; onTabChange: (id: string) => any; children: TabChild | TabChild[] };

export default class Tabs extends React.Component<Props> {
  render() {
    // const childrenWithProps = Preact.Children.map(props.children, child =>
    // cloneElement(child, { newProp: 'value' })
    // );
    const children = React.Children.map(this.props.children, child => {
      const childReactElement = child as TabChild;
      const childProps = childReactElement.props;

      const active = childProps.id === this.props.activeTabId;

      return React.cloneElement(childReactElement, {
        className: cn(childProps?.className, !active && 'hidden'),
        active,
      });
    });

    const activeTabIndex = this.props.tabs.findIndex(tab => tab.id === this.props.activeTabId);

    return (
      <div className="tabs">
        <div className="tabs-header">
          {this.props.tabs.map((tab, i) => (
            <TabItem tab={tab} active={this.props.activeTabId === tab.id} onClick={this.props.onTabChange} i={i} />
          ))}
          <div className="active-indicator" style={{ gridArea: `2 / ${activeTabIndex + 1} / auto / auto` }} />
        </div>
        <div className="tabs-body">{children}</div>
      </div>
    );
  }
}

type TabProps = { tab: Tab; active: boolean; onClick: (id: string) => any; i: number };
class TabItem extends React.Component<TabProps> {
  clicked = () => this.props.onClick(this.props.tab.id);
  render() {
    return (
      <div
        className={cn('tabs-header-item', this.props.active && 'active')}
        tabIndex={this.props.active ? 0 : -1}
        onClick={this.clicked}
        style={{ gridColumn: `${this.props.i + 1} / auto` }}
      >
        {this.props.tab.label}
      </div>
    );
  }
}
