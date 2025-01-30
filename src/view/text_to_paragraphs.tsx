import React from 'react';

export default function TextToParagraphs(props: { text: string }) {
  return (
    <>
      {props.text
        .split('\n')
        .map(x => x.trim())
        .filter(Boolean)
        .map(x => (
          <p>{x}</p>
        ))}
    </>
  );
}
