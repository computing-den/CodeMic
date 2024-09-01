import { h, Fragment, Component } from 'preact';
import Screen from './screen.jsx';
import _ from 'lodash';

export default class Player extends Component {
  render() {
    return (
      <Screen className="loading">
        <p>Loading ...</p>
      </Screen>
    );
  }
}
