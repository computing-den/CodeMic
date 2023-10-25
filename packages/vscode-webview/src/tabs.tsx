import { assert } from '@codecast/lib';
import { h, Fragment, Component, toChildArray } from 'preact';
import { cn } from './misc.js';
import _ from 'lodash';

export type Tab = {
  id: string;
  label: string;
};
export type TabViewProps = { id: string; className: string };
type Props = { tabs: Tab[]; activeTabId: string; onTabChange: (id: string) => any };

export default class Tabs extends Component<Props> {
  render() {
    for (const child of toChildArray(this.props.children)) {
      const childProps = (child as any).props;
      assert(childProps.id, 'Tab views must have IDs');

      if (childProps.id !== this.props.activeTabId) {
        childProps.className = cn(childProps.className, 'hidden');
      }
    }

    const activeTabIndex = this.props.tabs.findIndex(tab => tab.id === this.props.activeTabId);

    return (
      <div className="tabs">
        <div className="tabs-header">
          {this.props.tabs.map((tab, i) => (
            <TabItem tab={tab} isActive={this.props.activeTabId === tab.id} onClick={this.props.onTabChange} i={i} />
          ))}
          <div className="active-indicator" style={{ 'grid-area': `2 / ${activeTabIndex + 1} / auto / auto` }} />
        </div>
        <div className="tabs-body">{this.props.children}</div>
      </div>
    );
  }
}

type TabProps = { tab: Tab; isActive: boolean; onClick: (id: string) => any; i: number };
class TabItem extends Component<TabProps> {
  clicked = () => this.props.onClick(this.props.tab.id);
  render() {
    return (
      <div
        className={cn('tabs-header-item', this.props.isActive && 'active')}
        tabIndex={this.props.isActive ? 0 : -1}
        onClick={this.clicked}
        style={{ 'grid-column': `${this.props.i + 1} / auto` }}
      >
        {this.props.tab.label}
      </div>
    );
  }
}
