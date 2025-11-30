import MediaToolbar, { MediaToolbarButton, MediaToolbarMenu, PrimaryAction } from './media_toolbar.jsx';
import React, { memo } from 'react';
import postMessage from './api.js';
import _ from 'lodash';

export type Props = {
  className: string;
  playing: boolean;
  recording: boolean;
  onPlay: (clock?: number) => Promise<void>;
  onRecord: () => Promise<void>;
  clock: number; // TODO: Causes too many rerenders
  duration: number;
  sessionId: string;
  sessionHandle: string;
  sessionAuthor?: string;
  selectionStart?: number;
  onShowVideoChange: (showVideo: boolean) => void;
  guideVideoRef: React.RefObject<HTMLVideoElement>;
  playbackRate: number;
};

const RecorderMediaToolbar = memo(function RecorderMediaToolbar(props: Props) {
  let primaryAction: PrimaryAction;
  if (props.recording) {
    primaryAction = {
      type: 'recorder/pause',
      title: 'Record',
      onClick: async () => {
        await postMessage({ type: 'recorder/pause' });
      },
    };
  } else {
    primaryAction = {
      type: 'recorder/record',
      title: 'Record',
      disabled: props.playing,
      onClick: () => props.onRecord(),
    };
  }

  async function stepBackward() {
    await postMessage({ type: 'player/seek', clock: props.clock - 5 });
  }

  async function stepForward() {
    await postMessage({ type: 'player/seek', clock: props.clock + 5 });
  }

  async function togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        props.onShowVideoChange(true);
      } else {
        await props.guideVideoRef.current!.requestPictureInPicture();
        props.onShowVideoChange(false);
      }
    } catch (error) {
      console.error(error);
    }
  }

  const mediaToolbarActions = _.compact([
    props.playing ? (
      <MediaToolbarButton
        title="Pause"
        icon="codicon-debug-pause"
        onClick={() => postMessage({ type: 'recorder/pause' })}
      />
    ) : (
      <MediaToolbarButton title="Play" icon="codicon-play" disabled={props.recording} onClick={props.onPlay} />
    ),
    <MediaToolbarButton
      title="Jump 5s backwards"
      icon="codicon-chevron-left"
      onClick={stepBackward}
      disabled={props.recording || props.clock === 0}
    />,
    <MediaToolbarButton
      title="Jump 5s forward"
      icon="codicon-chevron-right"
      onClick={stepForward}
      disabled={props.recording || props.clock === props.duration}
    />,
    // <MediaToolbarButton
    //   title="Force sync workspace"
    //   icon="codicon-sync"
    //   onClick={() => postMessage({ type: 'recorder/syncWorkspace', clock: selectionClockRange?.start })}
    //   // NOTE: Must not programmatically change the workspace during recording
    //   //       because the changes will then be picked up by the recorder.
    //   disabled={session.recording}
    // />,
    // <MediaToolbarButton
    //   title="Picture-in-Picture"
    //   children={<PictureInPicture />}
    //   onClick={() => togglePictureInPicture()}
    //   // NOTE: change of video src does not trigger an update
    //   //       but it's ok for now, since state/props change during playback.
    //   disabled={!guideVideoRef.current?.src}
    // />,
    <MediaToolbarButton
      title="Share session"
      icon="codicon-link"
      onClick={() =>
        postMessage({
          type: 'copySessionLink',
          sessionId: props.sessionId,
          sessionHandle: props.sessionHandle,
          sessionAuthor: props.sessionAuthor,
        })
      }
    />,
    <MediaToolbarMenu
      onSync={() => postMessage({ type: 'recorder/syncWorkspace', clock: props.selectionStart })}
      onPiP={() => togglePictureInPicture()}
      canSync={!props.recording}
      // NOTE: change of video src does not trigger an update
      //       but it's ok for now, since state/props change during playback.
      canPiP={Boolean(props.guideVideoRef.current?.src)}
      canEdit={false}
      playbackRate={props.playbackRate}
      onPlaybackRate={rate => postMessage({ type: 'recorder/setPlaybackRate', rate })}
    />,
  ]);

  return (
    <MediaToolbar
      className={props.className}
      primaryAction={primaryAction}
      actions={mediaToolbarActions}
      clock={props.clock}
      duration={props.duration}
    />
  );
});

export default RecorderMediaToolbar;
