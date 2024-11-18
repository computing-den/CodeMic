import React from 'react';
import Screen from './screen.jsx';
import _ from 'lodash';

export default class Player extends React.Component {
  render() {
    return (
      <Screen className="loading">
        <p>Loading ...</p>
      </Screen>
    );
  }
}
