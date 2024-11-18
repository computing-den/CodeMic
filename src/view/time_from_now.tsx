import React, { useEffect, useMemo, useState } from 'react';
import moment from 'moment';
import _ from 'lodash';

type Props = { timestamp: string; capitalize?: boolean };
export default function TimeFromNow(props: Props) {
  const text = useMemo(() => moment(props.timestamp).fromNow(), [props.timestamp]);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(x => x + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return props.capitalize ? _.capitalize(text) : text;
}
