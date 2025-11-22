import MediaToolbar, { MediaToolbarButton, MediaToolbarMenu, PrimaryAction } from './media_toolbar.jsx';
import React, { forwardRef, Ref, useEffect, useRef, useState } from 'react';
import * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import { Vec2, Rect } from '../lib/lib.js';
import assert from '../lib/assert.js';
// import FakeMedia from './fake_media.js';
import PathField from './path_field.jsx';
import Tabs, { type TabViewProps } from './tabs.jsx';
import Screen from './screen.jsx';
import postMessage from './api.js';
import { mediaManager } from './media_manager.js';
import Toolbar from './toolbar.jsx';
import { cn } from './misc.js';
import _ from 'lodash';
import { VSCodeButton, VSCodeCheckbox, VSCodeTextArea, VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import Popover, { PopoverProps, usePopover } from './popover.jsx';
import path from 'path';
import { URI } from 'vscode-uri';
import Cover from './cover.jsx';
import PopoverMenu, { PopoverMenuItem } from './popover_menu.jsx';
import config from './config.js';

const TRACK_HEIGHT_PX = 15;
const TRACK_MIN_GAP_PX = 1;
const TRACK_INDENT_PX = 25;
// const TIMELINE_STEP_HEIGHT = 30;
// const TIMELINE_INITIAL_STEP_DURATION = 30;
const TIMELINE_MAX_PX_TO_TIME_RATIO = 60;
const TIMELINE_MIN_PX_TO_TIME_RATIO = 1 / 60;
const TIMELINE_DEFAULT_PX_TO_SEC_RATIO = 20;
// const TIMELINE_MIN_STEP_DURATION = 5;
const TIMELINE_WHEEL_ZOOM_SPEED = 0.001;

// type Marker = {
//   id: string;
//   clock: number;
//   type: 'clock' | 'anchor' | 'focus' | 'cursor' | 'end' | 'recording';
//   active?: boolean;
//   label?: string;
//   draggable?: boolean;
// };

type MarkerType = 'clock' | 'focus' | 'anchor' | 'cursor' | 'end' | 'recording' | 'chapter';
type MarkerDragLoad = { id: string; initClock: number };

type EditorViewProps = RecorderProps &
  TabViewProps & {
    onRecord: () => Promise<void>;
    onPlay: (clock?: number) => Promise<void>;
  };

type TimelineDrag<T> = { load: T; startClockUnderMouse: number; curClockUnderMouse: number };

type RecorderProps = { user?: t.UserUI; recorder: t.RecorderUIState; session: t.SessionUIState };
export default class Recorder extends React.Component<RecorderProps> {
  tabs = [
    { id: 'details-view', label: 'DETAILS' },
    { id: 'editor-view', label: 'EDITOR' },
  ];

  tabChanged = async (tabId: string) => {
    await postMessage({ type: 'recorder/openTab', tabId: tabId as t.RecorderUITabId });
  };

  loadRecorder = async () => {
    await postMessage({ type: 'recorder/load' });
  };

  play = async () => {
    await mediaManager.prepare();
    await postMessage({ type: 'recorder/play' });
  };

  record = async () => {
    await mediaManager.prepare();
    await postMessage({ type: 'recorder/record' });
  };

  componentDidUpdate(prevProps: RecorderProps) {
    if (this.props.session.loaded && !prevProps.session.loaded) {
      postMessage({ type: 'readyToLoadMedia' }).catch(console.error);
    }
  }

  componentDidMount() {
    if (this.props.session.loaded) {
      postMessage({ type: 'readyToLoadMedia' }).catch(console.error);
    }
  }

  componentWillUnmount() {
    mediaManager.dispose().catch(console.error);
  }

  render() {
    return (
      <Screen className="recorder">
        <Tabs
          tabs={this.tabs}
          activeTabId={this.props.recorder.tabId}
          onTabChange={this.tabChanged}
          hideHeader={!this.props.session.loaded}
        >
          <DetailsView id="details-view" {...this.props} onLoadRecorder={this.loadRecorder} />
          <EditorView id="editor-view" {...this.props} onRecord={this.record} onPlay={this.play} />
        </Tabs>
      </Screen>
    );
  }
}

type DetailsViewProps = RecorderProps & TabViewProps & { onLoadRecorder: () => any };
class DetailsView extends React.Component<DetailsViewProps> {
  state = {
    youtubeId: this.props.session.head.youtubeId ?? '',
  };
  titleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { title: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  handleChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { handle: (e.target as HTMLInputElement).value.replace(/[^A-Za-z0-9_-]/g, '') };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  workspaceChanged = async (workspace: string) => {
    const changes = { workspace };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  descriptionChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { description: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  youtubeIdChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    let value = (e.target as HTMLInputElement).value;

    const youtubeId = parseYoutubeId(value);
    if (youtubeId) {
      await postMessage({ type: 'recorder/updateDetails', changes: { youtubeId } });
      this.setState({ youtubeId });
    } else {
      await postMessage({ type: 'recorder/updateDetails', changes: { youtubeId: '' } });
      this.setState({ youtubeId: value });
    }
  };

  ignorePatternsChanged = async (e: Event | React.FormEvent<HTMLElement>) => {
    const changes = { ignorePatterns: (e.target as HTMLInputElement).value };
    await postMessage({ type: 'recorder/updateDetails', changes });
  };

  // save = async () => {
  //   await postMessage({ type: 'recorder/save' });
  // };

  publish = async () => {
    await postMessage({ type: 'recorder/publish' });
  };

  pickCover = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select cover photo',
        filters: { Image: ['png', 'jpg', 'jpeg'] },
      },
    });
    if (uris?.length === 1) {
      await postMessage({ type: 'recorder/setCover', uri: uris[0] });
      // this.setState({ coverKey: this.state.coverKey + 1 });
    }
  };

  deleteCover = async () => {
    await postMessage({ type: 'recorder/deleteCover' });
  };

  render() {
    const { session, id, className, onLoadRecorder } = this.props;
    const { youtubeId } = this.state;
    const { head, workspace, temp, local } = session;
    const isYoutubeIdValid = Boolean(parseYoutubeId(youtubeId));

    return (
      <div id={id} className={className}>
        <div className={cn('cover-container', head.hasCover && 'has-cover')}>
          <Cover local={local} head={head} />
          <div className="buttons">
            {head.hasCover && (
              <VSCodeButton
                className="delete"
                appearance="secondary"
                title="Delete cover photo"
                onClick={this.deleteCover}
              >
                Delete cover
              </VSCodeButton>
            )}
            <VSCodeButton className="pick" onClick={this.pickCover}>
              {head.hasCover ? 'Change cover' : 'Pick cover'}
            </VSCodeButton>
          </div>
        </div>
        <div className="subsection">
          <label className="label"></label>
        </div>
        <VSCodeTextArea
          className="title subsection"
          rows={2}
          resize="vertical"
          value={head.title}
          onInput={this.titleChanged}
          placeholder="The title of this session"
          autoFocus={!session.loaded}
        >
          Title
        </VSCodeTextArea>
        <PathField
          className="subsection"
          placeholder="Workspace directory"
          value={workspace}
          onChange={this.workspaceChanged}
          disabled={!temp}
          pickTitle="Pick workpace directory"
        >
          Workspace
        </PathField>
        <p className="subsection help">
          WARNING: workspace contents will be overwritten during recording and playback.
        </p>
        <VSCodeTextField
          className="subsection"
          placeholder="A-Z a-z 0-9 - _ (e.g. my_project)"
          value={head.handle}
          onInput={this.handleChanged}
          // disabled={!temp}
        >
          Handle
        </VSCodeTextField>
        <VSCodeTextArea
          className="description subsection"
          rows={10}
          resize="vertical"
          value={head.description}
          onInput={this.descriptionChanged}
          placeholder="What is this session about?"
        >
          Description
        </VSCodeTextArea>
        <VSCodeTextField
          className="subsection"
          placeholder="e.g. https://www.youtube.com/watch?v=Qp2GdLO5eSc"
          value={youtubeId}
          onInput={this.youtubeIdChanged}
          aria-invalid={Boolean(youtubeId && !isYoutubeIdValid)}
          pattern="[A-Za-z0-9]{5}"
          // disabled={!temp}
        >
          YouTube Video
        </VSCodeTextField>
        <p className="subsection help">
          YouTube video, if available, will be shown on <a href="https://CodeMic.io">CodeMic.io</a>
        </p>

        <VSCodeTextArea
          className="ignore subsection"
          rows={10}
          resize="vertical"
          value={head.ignorePatterns}
          onInput={this.ignorePatternsChanged}
          placeholder={lib.defaultIgnorePatterns}
        >
          Ignore patterns
        </VSCodeTextArea>
        <p className="subsection help">
          Ignore patterns have the same format as .gitignore. Files that match these patterns will not be scanned.
        </p>

        {/*<VSCodeTextField
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. https://github.com/computing-den/codemic.git"
        >
          Git repository
        </VSCodeTextField>
        <VSCodeTextField
          className="subsection"
          // value={''}
          // onInput={this.descriptionChanged}
          placeholder="e.g. 86056b1"
        >
          Git commit
        </VSCodeTextField>
        <p className="subsection help">
          Use <code>.codemicignore</code> to ignore paths.
        </p>*/}
        <div className="subsection buttons">
          <VSCodeButton
            onClick={this.publish}
            disabled={!session.loaded}
            appearance={session.loaded ? 'primary' : 'secondary'}
          >
            Publish
          </VSCodeButton>
          {/*<VSCodeButton appearance="secondary" onClick={this.save} disabled={session.mustScan}>
            Save
            </VSCodeButton>*/}
        </div>
        {!session.loaded && (
          <VSCodeButton className="subsection" onClick={onLoadRecorder} autoFocus>
            {session.mustScan ? 'Scan workspace to start' : 'Load session into workspace'}
            <span className="codicon codicon-chevron-right va-top m-left_small" />
          </VSCodeButton>
        )}
      </div>
    );
  }
}

function EditorView({ id, session, className, onRecord, onPlay, recorder }: EditorViewProps) {
  const { head } = session;
  const { canUndo, canRedo, selection } = recorder;
  const [cursor, setCursor] = useState<number>();
  const guideVideoRef = useRef<HTMLVideoElement>(null);
  const [showVideo, setShowVideo] = useState(true);

  const tracks = _.concat<t.RangedTrack>(
    session.audioTracks ?? [],
    session.videoTracks ?? [],
    session.imageTracks ?? [],
  );
  const selectionClockRange = lib.getRecorderSelectionClockRange(selection, tracks, head.toc);
  const selectedChapterIndex = selection?.type === 'chapter' ? selection.index : undefined;
  const selectedChapter = selectedChapterIndex !== undefined ? head.toc[selectedChapterIndex] : undefined;
  const hasEditorSelection = Boolean(getNonEmptyEditorSelection(selection));

  async function setSelection(selection?: t.RecorderSelection, opts?: { sync?: boolean }) {
    await postMessage({ type: 'recorder/setSelection', selection });
    if (opts?.sync && !session.recording) {
      const clock = lib.getRecorderSelectionClockRange(selection, tracks, head.toc)?.start;
      if (clock) await postMessage({ type: 'recorder/syncWorkspace', clock });
    }
  }
  async function extendSelection(clock: number) {
    await postMessage({ type: 'recorder/extendSelection', clock });
  }

  async function deleteSelection() {
    switch (selection?.type) {
      case 'track':
        return deleteTrack();
      case 'chapter':
        return deleteChapter();
      default:
        throw new Error('Cannot delete selection');
    }
  }

  async function deleteTrack() {
    assert(selection?.type === 'track');

    if (selection.trackType === 'audio') {
      await postMessage({ type: 'recorder/deleteAudio', id: selection.id });
    } else if (selection.trackType === 'video') {
      await postMessage({ type: 'recorder/deleteVideo', id: selection.id });
    } else {
      await postMessage({ type: 'recorder/deleteImage', id: selection.id });
    }
  }

  async function deleteChapter() {
    assert(selection?.type === 'chapter');

    await postMessage({ type: 'recorder/deleteChapter', index: selection.index });
  }

  function keyDown(e: KeyboardEvent) {
    const activeElement = document.activeElement;

    // Check for editable or interactive elements.
    if (
      activeElement &&
      activeElement instanceof HTMLElement &&
      (activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.tagName === 'SELECT' ||
        activeElement.tagName === 'VSCODE-TEXT-AREA' ||
        activeElement.tagName === 'VSCODE-TEXT-FIELD' ||
        activeElement.isContentEditable)
    ) {
      return;
    }

    if (e.key === 'Delete') {
      deleteSelection();
    }
  }

  useEffect(() => {
    document.addEventListener('keydown', keyDown);
    return () => document.removeEventListener('keydown', keyDown);
  }, [keyDown]);

  async function insertAudio() {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select audio file',
        filters: { 'MP3 Audio': ['mp3'] },
      },
    });
    if (uris?.length === 1) {
      const clock = selectionClockRange?.start ?? 0;
      await postMessage({ type: 'recorder/insertAudio', uri: uris[0], clock });
    }
  }

  async function insertVideo() {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select video file',
        filters: { 'MP4 Video': ['mp4'] },
      },
    });
    if (uris?.length === 1) {
      const clock = selectionClockRange?.start ?? 0;
      await postMessage({ type: 'recorder/insertVideo', uri: uris[0], clock });
    }
  }

  async function insertImage() {
    const { uris } = await postMessage({
      type: 'showOpenDialog',
      options: {
        title: 'Select image file',
        filters: { Image: ['jpg', 'jpeg', 'png', 'svg', 'webp'] },
      },
    });
    if (uris?.length === 1) {
      const clock = selectionClockRange?.start ?? 0;
      await postMessage({ type: 'recorder/insertImage', uri: uris[0], clock });
    }
  }

  async function togglePictureInPicture() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setShowVideo(true);
      } else {
        await guideVideoRef.current!.requestPictureInPicture();
        setShowVideo(false);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function stepBackward() {
    await postMessage({ type: 'player/seek', clock: session.clock - 5 });
  }

  async function stepForward() {
    await postMessage({ type: 'player/seek', clock: session.clock + 5 });
  }

  let primaryAction: PrimaryAction;
  if (session.recording) {
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
      disabled: session.playing,
      onClick: () => onRecord(),
    };
  }

  const mediaToolbarActions = _.compact([
    session.playing ? (
      <MediaToolbarButton
        title="Pause"
        icon="codicon-debug-pause"
        onClick={() => postMessage({ type: 'recorder/pause' })}
      />
    ) : (
      <MediaToolbarButton title="Play" icon="codicon-play" disabled={session.recording} onClick={onPlay} />
    ),
    <MediaToolbarButton
      title="Jump 5s backwards"
      icon="codicon-chevron-left"
      onClick={stepBackward}
      disabled={session.recording || session.clock === 0}
    />,
    <MediaToolbarButton
      title="Jump 5s forward"
      icon="codicon-chevron-right"
      onClick={stepForward}
      disabled={session.recording || session.clock === session.head.duration}
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
          sessionId: session.head.id,
          sessionHandle: session.head.handle,
          sessionAuthor: session.head.author,
        })
      }
    />,
    <MediaToolbarMenu
      onSync={() => postMessage({ type: 'recorder/syncWorkspace', clock: selectionClockRange?.start })}
      onPiP={() => togglePictureInPicture()}
      canSync={!session.recording}
      // NOTE: change of video src does not trigger an update
      //       but it's ok for now, since state/props change during playback.
      canPiP={Boolean(guideVideoRef.current?.src)}
      canEdit={false}
      playbackRate={session.playbackRate}
      onPlaybackRate={rate => postMessage({ type: 'recorder/setPlaybackRate', rate })}
    />,
  ]);

  const slowDownPopover = usePopover();
  const slowDownButtonRef = useRef(null);

  const speedUpPopover = usePopover();
  const speedUpButtonRef = useRef(null);

  async function changeSpeed(factor: number, adjustMediaTracks: boolean) {
    assert(selection?.type === 'editor');
    const range = getNonEmptyEditorSelection(selection);
    assert(range);

    // TODO disable speed control popover buttons till done.
    await postMessage({ type: 'recorder/changeSpeed', range, factor, adjustMediaTracks });

    slowDownPopover.close();
    speedUpPopover.close();
  }

  function slowDown(factor: number, adjustMediaTracks: boolean) {
    return changeSpeed(1 / factor, adjustMediaTracks);
  }
  function speedUp(factor: number, adjustMediaTracks: boolean) {
    return changeSpeed(factor, adjustMediaTracks);
  }

  const mergePopover = usePopover();
  const mergeButtonRef = useRef(null);

  async function merge(adjustMediaTracks: boolean) {
    assert(selection?.type === 'editor');
    const range = getNonEmptyEditorSelection(selection);
    assert(range);

    await postMessage({ type: 'recorder/merge', range, adjustMediaTracks });
    mergePopover.close();
  }

  const cropPopover = usePopover();
  const cropButtonRef = useRef(null);

  async function crop(adjustMediaTracks: boolean) {
    // assert(selection?.type === 'editor');
    const clock = selectionClockRange?.end;
    assert(clock !== undefined);
    await postMessage({ type: 'recorder/crop', clock, adjustMediaTracks });
    cropPopover.close();
  }

  const insertGapPopover = usePopover();
  const insertGapButtonRef = useRef(null);

  async function insertGap(dur: number, adjustMediaTracks: boolean) {
    const clock = selectionClockRange?.start;
    assert(clock !== undefined);
    await postMessage({ type: 'recorder/insertGap', clock, dur, adjustMediaTracks });
    insertGapPopover.close();
  }

  async function insertOrUpdateChapter(title: string, index?: number) {
    if (index === undefined) {
      // insert new.
      if (title) {
        const clock = selectionClockRange?.start;
        assert(clock !== undefined);
        await postMessage({ type: 'recorder/insertChapter', title, clock });
      }
    } else {
      // update old
      if (title) {
        await postMessage({ type: 'recorder/updateChapter', index, update: { title } });
      } else {
        await postMessage({ type: 'recorder/deleteChapter', index });
      }
    }
    chapterPopover.close();
  }

  function editChapter(index: number) {
    setSelection({ type: 'chapter', index }).then(() => chapterPopover.toggle());
  }

  const chapterPopover = usePopover();
  // const insertChapterButtonRef = useRef(null);
  const selectionRef = useRef(null);

  async function undo() {
    await postMessage({ type: 'recorder/undo' });
  }

  async function redo() {
    await postMessage({ type: 'recorder/redo' });
  }

  async function makeTest() {
    await postMessage({ type: 'recorder/makeTest' });
  }

  async function mergeVideoTracks() {
    await postMessage({ type: 'recorder/mergeVideoTracks' });
  }

  async function mergeAndReplaceVideoTracks() {
    await postMessage({ type: 'recorder/mergeVideoTracks', deleteOld: true });
  }

  const insertPopover = usePopover();
  const insertButtonRef = useRef(null);

  const insertMenuItems: PopoverMenuItem[] = [
    {
      title: 'Insert audio',
      icon: 'codicon codicon-mic',
      disabled: session.playing || session.recording,
      onClick: insertAudio,
    },
    {
      title: 'Insert video',
      icon: 'codicon codicon-device-camera-video',
      disabled: session.playing || session.recording,
      onClick: insertVideo,
    },
    {
      title: 'Insert image',
      icon: 'codicon codicon-device-camera',
      disabled: session.playing || session.recording,
      onClick: insertImage,
    },
    {
      title: 'Insert chapter',
      icon: 'fa-solid fa-font',
      disabled: session.playing || session.recording || selectionClockRange === undefined,
      onClick: chapterPopover.toggle,
    },
  ];

  const otherActionsPopover = usePopover();
  const otherActionsButtonRef = useRef(null);

  const otherActionsItems: PopoverMenuItem[] = _.compact([
    config.debug && {
      title: 'Merge video tracks',
      icon: 'fa-solid fa-link',
      disabled: session.playing || session.recording,
      onClick: mergeVideoTracks,
    },
    config.debug && {
      title: 'Merge & replace video tracks',
      icon: 'fa-solid fa-link',
      disabled: session.playing || session.recording,
      onClick: mergeAndReplaceVideoTracks,
    },
    config.debug && {
      title: 'Make test',
      icon: 'codicon codicon-beaker',
      disabled: session.playing || session.recording,
      onClick: makeTest,
    },
  ]);

  const toolbarActions = _.compact([
    <Toolbar.Button
      title="Undo"
      icon="fa-solid fa-rotate-left"
      disabled={!canUndo || session.playing || session.recording}
      onClick={undo}
    />,
    <Toolbar.Button
      title="Redo"
      icon="fa-solid fa-rotate-right"
      disabled={!canRedo || session.playing || session.recording}
      onClick={redo}
    />,
    <Toolbar.Separator />,
    // <Toolbar.Separator />,
    <Toolbar.Button
      ref={slowDownButtonRef}
      title="Slow down"
      icon="fa-solid fa-backward"
      disabled={session.playing || session.recording || !hasEditorSelection}
      onClick={slowDownPopover.toggle}
    />,
    <Toolbar.Button
      ref={speedUpButtonRef}
      title="Speed up"
      icon="fa-solid fa-forward"
      disabled={session.playing || session.recording || !hasEditorSelection}
      onClick={speedUpPopover.toggle}
    />,
    <Toolbar.Button
      ref={mergeButtonRef}
      title="Merge"
      icon="fa-solid fa-arrows-up-to-line"
      disabled={session.playing || session.recording || !hasEditorSelection}
      onClick={mergePopover.toggle}
    />,
    <Toolbar.Button
      ref={insertGapButtonRef}
      title="Insert gap"
      icon="fa-solid fa-arrows-left-right-to-line icon-rotate-cw-90"
      disabled={session.playing || session.recording || hasEditorSelection || selectionClockRange === undefined}
      onClick={insertGapPopover.toggle}
    />,
    <Toolbar.Button
      ref={cropButtonRef}
      title="Crop"
      icon="fa-solid fa-crop-simple"
      disabled={session.playing || session.recording || hasEditorSelection || selectionClockRange?.end === undefined}
      onClick={cropPopover.toggle}
    />,
    <Toolbar.Separator />,
    <Toolbar.Button
      ref={insertButtonRef}
      title="Insert"
      icon="codicon codicon-add"
      disabled={session.playing || session.recording}
      onClick={insertPopover.toggle}
    />,
    <Toolbar.Button
      title="Delete"
      icon="codicon codicon-trash"
      disabled={
        session.playing ||
        session.recording ||
        hasEditorSelection ||
        (selection?.type !== 'track' && selection?.type !== 'chapter')
      }
      onClick={deleteSelection}
    />,
    otherActionsItems.length > 0 && <Toolbar.Separator />,
    otherActionsItems.length > 0 && (
      <Toolbar.Button
        ref={otherActionsButtonRef}
        title="More"
        icon="codicon codicon-kebab-vertical"
        onClick={otherActionsPopover.toggle}
      />
    ),
  ]);

  return (
    <div id={id} className={className}>
      <MediaToolbar
        className="subsection subsection_spaced"
        primaryAction={primaryAction}
        actions={mediaToolbarActions}
        clock={session.clock}
        duration={head.duration}
      />
      <div className={cn('subsection subsection_spaced guide-video-container', !showVideo && 'hide')}>
        <video id="guide-video" ref={guideVideoRef} />
        <div className="empty-content">
          <span className="codicon codicon-device-camera-video" />
        </div>
        <VSCodeButton
          className="toggle-button"
          appearance="icon"
          title="Hide video"
          onClick={() => setShowVideo(!showVideo)}
        >
          <span className={cn('codicon', showVideo ? 'codicon-chevron-up' : 'codicon-chevron-down')} />
        </VSCodeButton>
      </div>
      <div className="subsection">
        <Toolbar actions={toolbarActions} />
      </div>
      <Timeline
        session={session}
        // markers={state.markers}
        cursor={cursor}
        // anchor={state.anchor}
        // focus={state.focus}
        // trackSelection={state.trackSelection}
        setSelection={setSelection}
        extendSelection={extendSelection}
        setCursor={setCursor}
        selection={selection}
        // onChange={updateState}
        editChapter={editChapter}
        selectionRef={selectionRef}
      />
      <SpeedControlPopover
        popover={slowDownPopover}
        onConfirm={slowDown}
        anchor={slowDownButtonRef}
        pointOnAnchor="bottom-center"
        pointOnPopover="top-center"
        title="Slow down"
      />
      <SpeedControlPopover
        popover={speedUpPopover}
        onConfirm={speedUp}
        anchor={speedUpButtonRef}
        pointOnAnchor="bottom-center"
        pointOnPopover="top-center"
        title="Speed up"
      />
      <MergePopover
        popover={mergePopover}
        onConfirm={merge}
        anchor={mergeButtonRef}
        pointOnAnchor="bottom-left"
        pointOnPopover="top-left"
      />
      <InsertGapPopover
        popover={insertGapPopover}
        onConfirm={insertGap}
        anchor={insertGapButtonRef}
        pointOnAnchor="bottom-left"
        pointOnPopover="top-left"
      />
      <CropPopover
        popover={cropPopover}
        onConfirm={crop}
        anchor={cropButtonRef}
        pointOnAnchor="bottom-left"
        pointOnPopover="top-left"
      />
      <PopoverMenu
        popover={insertPopover}
        anchor={insertButtonRef}
        pointOnAnchor="bottom-left"
        pointOnPopover="top-left"
        items={insertMenuItems}
      />
      <PopoverMenu
        popover={otherActionsPopover}
        anchor={otherActionsButtonRef}
        pointOnAnchor="bottom-right"
        pointOnPopover="top-right"
        items={otherActionsItems}
      />
      {selectionClockRange?.start !== undefined && (
        <ChapterPopover
          chapter={selectedChapter}
          index={selectedChapterIndex}
          popover={chapterPopover}
          onConfirm={insertOrUpdateChapter}
          anchor={selectionRef}
          pointOnAnchor="bottom-left"
          pointOnPopover="top-left"
          clock={selectionClockRange.start}
        />
      )}
    </div>
  );
}

type TimelineProps = {
  session: t.SessionUIState;
  cursor?: number;
  selection?: t.RecorderSelection;
  setSelection: (selection: t.RecorderSelection, opts?: { sync?: boolean }) => Promise<void>;
  extendSelection: (clock: number) => Promise<void>;
  setCursor: (clock?: number) => any;
  editChapter: (index: number) => any;
  selectionRef: Ref<any>;
};
type TimelineState = {
  pxToSecRatio: number;
  trackDrag?: TimelineDrag<t.RangedTrack>;
  trackExtendDrag?: TimelineDrag<t.RangedTrack>;
  markerDrag?: TimelineDrag<MarkerDragLoad>;
};
class Timeline extends React.Component<TimelineProps, TimelineState> {
  state = {
    pxToSecRatio: TIMELINE_DEFAULT_PX_TO_SEC_RATIO,
  } as TimelineState;

  mouseIsDown?: boolean;
  zoomState?: {
    timestampMs: number;
    clock: number;
    clientY: number;
  };

  // getTimelineStepClock(): number {
  //   return calcTimelineStepClock(this.props.recorder.head.duration, this.state.stepCount);
  // }

  getRulerStepDur(): number {
    const { pxToSecRatio } = this.state;
    if (pxToSecRatio >= 11) {
      return 1;
    } else if (pxToSecRatio >= 7 && pxToSecRatio < 11) {
      return 2;
    } else if (pxToSecRatio >= 3.4 && pxToSecRatio < 7) {
      return 5;
    } else if (pxToSecRatio >= 1.6 && pxToSecRatio < 3.4) {
      return 10;
    } else if (pxToSecRatio >= 0.64 && pxToSecRatio < 1.6) {
      return 30;
    } else if (pxToSecRatio >= 0.3 && pxToSecRatio < 0.64) {
      return 60;
    } else if (pxToSecRatio >= 0.11 && pxToSecRatio < 0.3) {
      return 60 * 5;
    } else if (pxToSecRatio >= 0.06 && pxToSecRatio < 0.11) {
      return 60 * 10;
    } else if (pxToSecRatio >= 0.03 && pxToSecRatio < 0.06) {
      return 60 * 15;
    } else {
      return 60 * 30;
    }
  }

  getTimelineDuration(): number {
    const stepDur = this.getRulerStepDur();
    return roundTo(this.props.session.head.duration + stepDur * 4, stepDur);
  }

  wheelMoved = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();

      const clock = this.getClockUnderMouse(e);
      if (!clock) return;

      // if (!this.zoomState || this.zoomState.timestampMs < Date.now() - 300) {
      this.zoomState = { timestampMs: Date.now(), clock, clientY: e.clientY };
      console.log('setting zoomState: ', JSON.stringify(this.zoomState));
      // }

      // 120  => px2sec = px2sec * 1.1
      // -120 => px2sec = px2sec * 0.9

      // 120 / 1000 = 0.12
      // 0.12 + 1 = 1.12

      // -120 /1000 = -0.12
      // -0.12 + 1 = 0.88

      let pxToSecRatio = this.state.pxToSecRatio * (1 - e.deltaY * TIMELINE_WHEEL_ZOOM_SPEED);
      pxToSecRatio = Math.min(TIMELINE_MAX_PX_TO_TIME_RATIO, Math.max(TIMELINE_MIN_PX_TO_TIME_RATIO, pxToSecRatio));
      this.setState({ pxToSecRatio });

      // // const newStepDuration = this.state.stepDuration + (e.deltaY / 100) * TIMELINE_ZOOM_MULTIPLIER;
      // const clippedStepDuration = Math.min(
      //   this.getTimelineDuration() / 2,
      //   Math.max(TIMELINE_MIN_STEP_DURATION, newStepDuration),
      // );
      // this.setState({ stepDuration: clippedStepDuration });

      // const deltaModes = { 0: 'pixel', 1: 'line', 2: 'page' } as Record<number, string>;
      // console.log(
      //   `wheel delta: ${e.deltaY}, wheel deltaMode: ${
      //     deltaModes[e.deltaMode]
      //   }, new step dur: ${newStepDuration}, clipped: ${clippedStepDuration}`,
      // );
    }
  };

  mouseMoved = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e);

    if (this.mouseIsDown && clock !== undefined) {
      this.props.setCursor();
      this.props.extendSelection(clock);
    } else {
      if (clock === undefined || !this.isMouseOverEmptySpaceInTimeline(e)) {
        this.props.setCursor();
      } else {
        this.props.setCursor(clock);
      }
    }
  };

  mouseLeft = (e: MouseEvent) => {
    this.props.setCursor();
  };

  mouseOut = (e: MouseEvent) => {};

  mouseDown = (e: MouseEvent) => {
    const clock = this.getClockUnderMouse(e, { emptySpace: true });
    if (clock !== undefined) {
      this.mouseIsDown = true;
      if (e.shiftKey) {
        this.props.extendSelection(clock);
      } else {
        this.props.setSelection({ type: 'editor', anchor: clock, focus: clock }, { sync: e.ctrlKey || e.metaKey });
      }
    }
  };

  mouseUp = (e: MouseEvent) => {
    this.mouseIsDown = undefined;
    // const {anchor} = this.props;
    // if (anchor) {
    //   const clock = this.getClockUnderMouse(e, {emptySpace: true});
    //   const tolerance = this.getTimelineDuration() / 300;
    //   if (clock !== undefined && lib.approxEqual(clock, anchor.clock, tolerance)) {
    //     this.props.onChange(state => {
    //       state.anchor = undefined;
    //       selection = {fromClock: anchor.clock, toClock: clock, active}
    //     })
    //   }
    // }
  };

  // getSelectionFromTrack = (track: t.RangedTrack): TrackSelection => {
  //   return { id: track.id, trackType: track.type };
  // };

  trackClicked = (e: React.MouseEvent, track: t.RangedTrack) => {
    e.stopPropagation();
    this.props.setSelection({ type: 'track', trackType: track.type, id: track.id });
  };

  trackDragStarted = (e: React.DragEvent, track: t.RangedTrack) => {
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.setDragImage(new Image(), 0, 0);
      e.dataTransfer.effectAllowed = 'none';
    }
    // if (track.type === 'editor') return;

    const startClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (startClockUnderMouse !== undefined) {
      console.log('trackDragStarted', track, startClockUnderMouse);
      this.setState({ trackDrag: { load: track, startClockUnderMouse, curClockUnderMouse: startClockUnderMouse } });
    }
  };

  trackDragEnded = async (e: React.DragEvent, _track: t.RangedTrack) => {
    const { trackDrag } = this.state;
    if (!trackDrag) return;

    const clockRange = getClockRangeOfTrackDrag(trackDrag);
    if (trackDrag.load.type === 'audio') {
      await postMessage({ type: 'recorder/updateAudio', update: { id: trackDrag.load.id, clockRange } });
    } else if (trackDrag.load.type === 'video') {
      await postMessage({ type: 'recorder/updateVideo', update: { id: trackDrag.load.id, clockRange } });
    } else if (trackDrag.load.type === 'image') {
      await postMessage({ type: 'recorder/updateImage', update: { id: trackDrag.load.id, clockRange } });
    }

    // Must be after postMessage to avoid flash of old track.
    this.setState({ trackDrag: undefined });
  };

  trackDragged = (e: React.DragEvent, _track: t.RangedTrack) => {
    const curClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (curClockUnderMouse !== undefined && this.state.trackDrag) {
      this.setState({ trackDrag: { ...this.state.trackDrag, curClockUnderMouse } });
    }
  };

  trackExtendDragStarted = (e: React.DragEvent, track: t.RangedTrack) => {
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.setDragImage(new Image(), 0, 0);
      e.dataTransfer.effectAllowed = 'none';
    }

    const startClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (startClockUnderMouse !== undefined) {
      console.log('trackExtendDragStarted', track, startClockUnderMouse);
      this.setState({
        trackExtendDrag: { load: track, startClockUnderMouse, curClockUnderMouse: startClockUnderMouse },
      });
    }
  };

  trackExtendDragEnded = async (e: React.DragEvent, _track: t.RangedTrack) => {
    const { trackExtendDrag } = this.state;
    if (!trackExtendDrag) return;

    const clockRange = getClockRangeOfTrackExtendDrag(trackExtendDrag);
    if (trackExtendDrag.load.type === 'image') {
      await postMessage({ type: 'recorder/updateImage', update: { id: trackExtendDrag.load.id, clockRange } });
    } else {
      throw Error(`Cannot extend track ${trackExtendDrag.load.type}`);
    }

    // Must be after postMessage to avoid flash of old track.
    this.setState({ trackExtendDrag: undefined });
  };

  trackExtendDragged = (e: React.DragEvent, _track: t.RangedTrack) => {
    const curClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (curClockUnderMouse !== undefined && this.state.trackExtendDrag) {
      this.setState({ trackExtendDrag: { ...this.state.trackExtendDrag, curClockUnderMouse } });
    }
  };

  editChapter = (e: React.MouseEvent, i: number) => {
    e.stopPropagation();
    this.props.editChapter(i);
  };

  chapterClicked = (e: React.MouseEvent, i: number) => {
    if (e.shiftKey) {
      this.props.extendSelection(this.props.session.head.toc[i].clock);
    } else {
      this.props.setSelection({ type: 'chapter', index: i }, { sync: e.ctrlKey || e.metaKey });
    }
  };

  chapterDragStarted = (e: React.DragEvent, i: number) => {
    e.dataTransfer?.setDragImage(new Image(), 0, 0);
    const startClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (startClockUnderMouse !== undefined) {
      const initClock = this.props.session.head.toc[i].clock;
      this.setState({
        markerDrag: {
          load: { id: `chapter-${i}`, initClock },
          startClockUnderMouse,
          curClockUnderMouse: startClockUnderMouse,
        },
      });
    }
  };

  chapterDragEnded = async (e: React.DragEvent, i: number) => {
    assert(this.state.markerDrag);
    assert(this.props.session.head.toc[i]);
    const clock = getClockOfTimelineDrag(this.props.session.head.toc[i].clock, this.state.markerDrag);
    await postMessage({ type: 'recorder/updateChapter', index: i, update: { clock } });
    this.setState({ markerDrag: undefined });
  };

  chapterDragged = async (e: React.DragEvent, i: number) => {
    const curClockUnderMouse = this.getClockUnderMouse(e.nativeEvent);
    if (curClockUnderMouse !== undefined && this.state.markerDrag) {
      this.setState({ markerDrag: { ...this.state.markerDrag, curClockUnderMouse } });
    }
  };

  clockClicked = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      this.props.extendSelection(this.props.session.clock);
    } else {
      this.props.setSelection(
        { type: 'editor', anchor: this.props.session.clock, focus: this.props.session.clock },
        { sync: e.ctrlKey || e.metaKey },
      );
    }
  };

  anchorClicked = (e: React.MouseEvent) => {
    assert(this.props.selection?.type === 'editor');
    this.props.setSelection({
      type: 'editor',
      anchor: this.props.selection.anchor,
      focus: this.props.selection.anchor,
    });
  };

  focusClicked = (e: React.MouseEvent) => {
    assert(this.props.selection?.type === 'editor');
    if (e.shiftKey) {
      // nothing
    } else {
      this.props.setSelection(
        {
          type: 'editor',
          anchor: this.props.selection.focus,
          focus: this.props.selection.focus,
        },
        { sync: e.ctrlKey || e.metaKey },
      );
    }
  };

  endClicked = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      this.props.extendSelection(this.props.session.head.duration);
    } else {
      this.props.setSelection(
        {
          type: 'editor',
          anchor: this.props.session.head.duration,
          focus: this.props.session.head.duration,
        },
        { sync: e.ctrlKey || e.metaKey },
      );
    }
  };

  autoScroll = () => {
    const marker = document.getElementById(this.props.session.playing ? 'marker_clock' : 'marker_recording');
    if (!marker) return;

    const timeline = document.getElementById('timeline')!;
    const timelineRect = timeline.getBoundingClientRect();
    const markerRecordingRect = marker.getBoundingClientRect();
    timeline.scrollTop -= timelineRect.bottom - markerRecordingRect.top - 50;
  };

  scrollAfterZoom = () => {
    /*
     __________  Timeline Body (TB) -|
    |          |                     |
    |          |                     |
    |          |                     |
    |          |                     |
    |__________| Timeline (T) -|     |
    |==========| + padding     |     |
    |          |               |     |
    |----------| ClientY (CY)  |     |
    |          |               |     |
    |__________|               |     |


    Clock@CY = ( (CY - TB.top) / TB.height ) * dur
    TB.top = CY - Clock@CY * TB.height / dur

    T.scroll = T.top + T.padding - TB.top
    T.scroll = T.top + T.padding - (CY - Clock@CY * TB.height / dur)

    */

    if (!this.zoomState) return;

    // Scroll timeline to keep the mouse position the same after zoom.
    const timeline = document.getElementById('timeline')!;
    const timelineBody = document.getElementById('timeline-body')!;
    const timelineRect = Rect.fromDOMRect(timeline.getBoundingClientRect());
    const timelineBodyRect = Rect.fromDOMRect(timelineBody.getBoundingClientRect());
    const dur = this.getTimelineDuration();
    const timelineTopPadding = parseFloat(window.getComputedStyle(timeline).paddingTop) || 0;

    console.log(
      `scroll: ${timeline.scrollTop} = T.top ${timelineRect.top} - TB.top ${
        timelineBodyRect.top
      } + TP ${timelineTopPadding} = ${timelineRect.top - timelineBodyRect.top + timelineTopPadding}`,
    );

    const top =
      timelineRect.top +
      timelineTopPadding -
      (this.zoomState.clientY - (this.zoomState.clock * timelineBodyRect.height) / dur);
    timeline.scrollTo({ behavior: 'instant', top });
  };

  getClockUnderMouse(e: MouseEvent, opts?: { emptySpace?: boolean }): number | undefined {
    if (opts?.emptySpace && !this.isMouseOverEmptySpaceInTimeline(e)) return;

    const clientPos = new Vec2(e.clientX, e.clientY);
    const timeline = document.getElementById('timeline')!;
    const timelineBody = document.getElementById('timeline-body')!;
    const timelineRect = Rect.fromDOMRect(timeline.getBoundingClientRect());
    const timelineBodyRect = Rect.fromDOMRect(timelineBody.getBoundingClientRect());
    if (timelineRect.isPointInRect(clientPos)) {
      const mouseOffsetInTimelineBody = Math.min(
        timelineBodyRect.height,
        Math.max(0, clientPos.y - timelineBodyRect.top),
      );
      const ratio = mouseOffsetInTimelineBody / timelineBodyRect.height;
      return ratio * this.getTimelineDuration();
    }
  }

  isMouseOverEmptySpaceInTimeline(e: MouseEvent): boolean {
    const target = e.target as HTMLElement;
    return Boolean(target.closest('#timeline') && !target.closest('.track, .marker, .line-focus p, .document-focus'));
  }

  // updateTimelineHeightPx = () => {
  //   const timelineHeightPx = document.getElementById('timeline-body')!.getBoundingClientRect().height;
  //   if (timelineHeightPx !== this.state.timelineHeightPx) {
  //     console.log('updateTimelineHeightPx', timelineHeightPx);
  //     this.setState({ timelineHeightPx });
  //   }
  // };

  // resized = () => this.updateTimelineHeightPx();

  componentDidMount() {
    // window.addEventListener('resize', this.resized);
    // this.updateTimelineHeightPx();

    const timeline = document.getElementById('timeline')!;
    timeline.addEventListener('wheel', this.wheelMoved);

    document.addEventListener('mousemove', this.mouseMoved);
    document.addEventListener('mousedown', this.mouseDown);
    document.addEventListener('mouseup', this.mouseUp);

    const timelineBody = document.getElementById('timeline-body')!;
    timelineBody.addEventListener('mouseleave', this.mouseLeft);
    timelineBody.addEventListener('mouseout', this.mouseOut);
  }

  componentWillUnmount() {
    // window.removeEventListener('resize', this.resized);

    const timeline = document.getElementById('timeline')!;
    timeline.removeEventListener('wheel', this.wheelMoved);
    document.removeEventListener('mousemove', this.mouseMoved);
    document.removeEventListener('mousedown', this.mouseDown);
    document.removeEventListener('mouseup', this.mouseUp);

    const timelineBody = document.getElementById('timeline-body')!;
    timelineBody.removeEventListener('mouseleave', this.mouseLeft);
    timelineBody.removeEventListener('mouseout', this.mouseOut);
  }

  componentDidUpdate(prevProps: TimelineProps, prevState: TimelineState) {
    if (this.props.session.recording /* || this.props.session.playing*/) {
      this.autoScroll();
    }

    if (prevState.pxToSecRatio !== this.state.pxToSecRatio) {
      this.scrollAfterZoom();
    }
  }

  render() {
    const { cursor, selection, session, setSelection, extendSelection, editChapter, selectionRef } = this.props;
    const { pxToSecRatio, trackDrag, trackExtendDrag, markerDrag } = this.state;
    // const clockMarker: Marker | undefined =
    //   session.clock > 0 && session.clock !== session.head.duration && !session.recording
    //     ? { id: 'clock', clock: session.clock, type: 'clock' }
    //     : undefined;
    // const endOrRecordingMarker: Marker = session.recording
    //   ? { id: 'recording', clock: session.head.duration, type: 'recording' }
    //   : { id: 'end', clock: session.head.duration, type: 'end' };

    const editorSelectionRange = getNonEmptyEditorSelection(selection);

    // const allMarkers = _.compact([
    //   cursor,
    //   hasEditorSelection && anchor,
    //   focus,
    //   clockMarker,
    //   endOrRecordingMarker,
    // ]);
    const timelineDuration = this.getTimelineDuration();

    // const groupedEditorTracks = groupEditorEvents(recorder.editorTrack!.events, timelineDuration, timelineHeightPx);
    const tracks = _.orderBy(
      _.concat<t.RangedTrack>(session.audioTracks ?? [], session.videoTracks ?? [], session.imageTracks ?? []),
      track => track.clockRange.start,
    );

    const rulerStepDur = this.getRulerStepDur();

    return (
      <div id="timeline" className="subsection">
        <div
          id="timeline-body"
          style={{
            height: `${this.getTimelineDuration() * pxToSecRatio + 1}px`,
          }}
        >
          <div className="timeline-grid">
            <EditorTrackUI
              sessionDuration={session.head.duration}
              workspaceFocusTimeline={session.workspaceFocusTimeline}
              timelineDuration={timelineDuration}
              // timelineHeightPx={timelineHeightPx}
              pxToSecRatio={pxToSecRatio}
              setSelection={setSelection}
              extendSelection={extendSelection}
            />
            <RangedTracksUI
              timelineDuration={timelineDuration}
              tracks={tracks}
              selection={selection}
              trackDrag={trackDrag}
              onClick={this.trackClicked}
              onDrag={this.trackDragged}
              onDragStart={this.trackDragStarted}
              onDragEnd={this.trackDragEnded}
              trackExtendDrag={trackExtendDrag}
              onExtendDrag={this.trackExtendDragged}
              onExtendDragStart={this.trackExtendDragStarted}
              onExtendDragEnd={this.trackExtendDragEnded}
            />
            <div className="markers">
              {cursor !== undefined && (
                <MarkerUI id="cursor" type="cursor" clock={cursor} timelineDuration={timelineDuration} />
              )}
              {selection?.type === 'editor' && (
                <>
                  <MarkerUI
                    id="anchor"
                    type="anchor"
                    clock={selection.anchor}
                    timelineDuration={timelineDuration}
                    onClick={this.anchorClicked}
                  />
                  <MarkerUI
                    id="focus"
                    type="focus"
                    clock={selection.focus}
                    timelineDuration={timelineDuration}
                    active
                    ref={selectionRef}
                    onClick={this.focusClicked}
                  />
                </>
              )}
              {session.head.toc?.map((entry, i) => (
                <MarkerUI
                  id={`chapter-${i}`}
                  type="chapter"
                  clock={entry.clock}
                  timelineDuration={timelineDuration}
                  active={selection?.type === 'chapter' && selection.index === i}
                  label={entry.title}
                  buttons={[
                    <VSCodeButton
                      appearance="icon"
                      title="Edit"
                      onClick={e => {
                        this.editChapter(e, i);
                      }}
                    >
                      <span className="codicon codicon-edit" />
                    </VSCodeButton>,
                  ]}
                  hideTime
                  markerDrag={markerDrag}
                  draggable
                  onClick={e => this.chapterClicked(e, i)}
                  onDragStart={e => this.chapterDragStarted(e, i)}
                  onDragEnd={e => this.chapterDragEnded(e, i)}
                  onDrag={e => this.chapterDragged(e, i)}
                  ref={selection?.type === 'chapter' && selection.index === i ? selectionRef : null}
                />
              ))}
              {session.clock > 0 && session.clock !== session.head.duration && !session.recording && (
                <MarkerUI
                  id="clock"
                  type="clock"
                  clock={session.clock}
                  timelineDuration={timelineDuration}
                  onClick={this.clockClicked}
                />
              )}
              {session.recording && (
                <MarkerUI
                  id="recording"
                  type="recording"
                  clock={session.head.duration}
                  timelineDuration={timelineDuration}
                />
              )}
              {!session.recording && (
                <MarkerUI
                  id="end"
                  type="end"
                  clock={session.head.duration}
                  timelineDuration={timelineDuration}
                  onClick={this.endClicked}
                />
              )}
            </div>
            {editorSelectionRange && (
              <RangeSelection timelineDuration={timelineDuration} range={editorSelectionRange} />
            )}
          </div>
          <div id="ruler">
            {_.times(this.getTimelineDuration() / rulerStepDur + 1, i => (
              <div className="step">
                <div className="indicator"></div>
                <div className="time">{lib.formatTimeSeconds(i * rulerStepDur)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
}

type RangedTracksUIProps = {
  timelineDuration: number;
  tracks: t.RangedTrack[];
  selection?: t.RecorderSelection;
  onClick: (e: React.MouseEvent, track: t.RangedTrack) => any;
  onDragStart: (e: React.DragEvent, track: t.RangedTrack) => any;
  onDragEnd: (e: React.DragEvent, track: t.RangedTrack) => any;
  onDrag: (e: React.DragEvent, track: t.RangedTrack) => any;
  trackDrag?: TimelineDrag<t.RangedTrack>;

  onExtendDragStart: (e: React.DragEvent, track: t.RangedTrack) => any;
  onExtendDragEnd: (e: React.DragEvent, track: t.RangedTrack) => any;
  onExtendDrag: (e: React.DragEvent, track: t.RangedTrack) => any;
  trackExtendDrag?: TimelineDrag<t.RangedTrack>;
};
// type RangedTrackLayout = {
//   start: number;
//   end: number;
//   track: t.RangedTrack;
//   indent: number;
// };
// type TrackLayout = {columns: RangedTrackLayoutColumn[]};
// type RangedTrackLayoutColumn = {};
// type RangedTrackLayoutColumn = t.RangedTrack[];
function RangedTracksUI(props: RangedTracksUIProps) {
  const {
    tracks,
    timelineDuration,
    selection,
    onClick,
    onDrag,
    onDragStart,
    onDragEnd,
    trackDrag,
    onExtendDrag,
    onExtendDragStart,
    onExtendDragEnd,
    trackExtendDrag,
  } = props;

  const layouts: { track: t.RangedTrack; indent: number }[] = tracks.map(track => ({ track, indent: 0 }));
  for (const [i, layout] of layouts.entries()) {
    for (const layout2 of layouts.slice(0, i)) {
      if (lib.doClockRangesOverlap(layout.track.clockRange, layout2.track.clockRange)) {
        layout.indent = Math.max(layout.indent, layout2.indent) + 1;
      }
    }
  }

  return (
    <div className="ranged-tracks">
      {layouts.map(({ indent, track }, i) => {
        const indentPx = indent * TRACK_INDENT_PX;
        const selected = selection?.type === 'track' && selection.id === track.id;
        const dragging = track.id === trackDrag?.load.id;
        const extending = track.id === trackExtendDrag?.load.id;

        let clockRange = track.clockRange;
        if (dragging) {
          clockRange = getClockRangeOfTrackDrag(trackDrag);
        } else if (extending) {
          clockRange = getClockRangeOfTrackExtendDrag(trackExtendDrag);
        }

        const style = {
          // left: `calc(${start * 50}% + ${columnHalfGap}rem + ${indent * TRACK_INDENT_PX}px)`,
          // width: `calc(${(end - start) * 50}% - ${columnHalfGap * 2}rem - ${indent * TRACK_INDENT_PX}px)`,
          right: `${indentPx}px`,
          // maxWidth: `calc(50px - ${indentPx})`,
          top: `${(clockRange.start / timelineDuration) * 100}%`,
          bottom: `calc(100% - ${(clockRange.end / timelineDuration) * 100}%)`,
          minHeight: `${TRACK_HEIGHT_PX}px`,
        };

        let icon = '';
        let showResizeHandle = false;
        if (track.type === 'audio') {
          icon = 'codicon-mic';
        } else if (track.type === 'video') {
          icon = 'codicon-device-camera-video';
        } else if (track.type === 'image') {
          icon = 'codicon-device-camera';
          showResizeHandle = true;
        }

        return (
          <div
            key={track.id}
            className={cn(
              'track',
              (selected || dragging || extending) && 'active',
              dragging && 'dragging',
              extending && 'extending',
            )}
            style={style}
            onClick={e => onClick(e, track)}
            onDragStart={e => onDragStart(e, track)}
            onDrag={e => onDrag(e, track)}
            onDragEnd={e => onDragEnd(e, track)}
            draggable
          >
            <p>
              <span className={`codicon va-middle m-right_small ${icon}`} />
              {track.title}
            </p>
            {showResizeHandle && (
              <span
                className="resize-handle codicon codicon-arrow-both"
                onDragStart={e => onExtendDragStart(e, track)}
                onDrag={e => onExtendDrag(e, track)}
                onDragEnd={e => onExtendDragEnd(e, track)}
                draggable
              />
            )}
          </div>
        );
      })}
    </div>
  );

  // private fitTrackIntoColumns(track: t.RangedTrack, columns: RangedTrackLayoutColumn[]) {
  //   for (const column of columns) {
  //     if (this.doesTrackFitInColumn(track, column)) {
  //       column.push(track);
  //       return;
  //     }
  //   }
  //   columns.push([track]);
  // }

  // private doesTrackFitInColumn(track: t.RangedTrack, column: RangedTrackLayoutColumn): boolean {
  //   return column.every(track2 => !this.doClockRangesOverlap(track, track2));
  // }

  // private orderedColumn(columns: RangedTrackLayoutColumn): RangedTrackLayoutColumn {
  //   return _.orderBy(columns, track => track.clockRange.start);
  // }
}

type EditorTrackUIProps = {
  sessionDuration: number;
  timelineDuration: number;
  pxToSecRatio: number;
  workspaceFocusTimeline?: t.Focus[];
  setSelection: (selection: t.RecorderSelection, opts?: { sync?: boolean }) => Promise<void>;
  extendSelection: (clock: number) => Promise<void>;
};
function EditorTrackUI(props: EditorTrackUIProps) {
  const { sessionDuration, timelineDuration, pxToSecRatio, workspaceFocusTimeline, setSelection, extendSelection } =
    props;

  // const lineFocusItems:t.LineFocus [] = [];
  // if (workspaceFocusTimeline) {
  //   const { documents, lines } = workspaceFocusTimeline;
  //   const durationOfOneLine = (TRACK_HEIGHT_PX * timelineDuration) / timelineHeightPx;

  //   // Cut duration of document focus items to durationOfOneLine.
  //   const clockRangesOfOccupiedLines: t.ClockRange[] = documents.map(x => ({
  //     start: x.clockRange.start,
  //     end: x.clockRange.start + durationOfOneLine,
  //   }));

  //   for (const line of lines) {
  //     const lineClockRange: t.ClockRange = {
  //       start: line.clockRange.start,
  //       end: line.clockRange.start + durationOfOneLine,
  //     };

  //     // TODO write an algorithm with better time complexity.
  //     if (!clockRangesOfOccupiedLines.some(x => lib.doClockRangesOverlap(x, lineClockRange))) {
  //       lineFocusItems.push(line);
  //     }
  //   }
  // }

  // Skip lines that may cut into the previous line.
  const lineFocusTimeline: { text: string; clockRange: t.ClockRange; offsetPx: number }[] = [];
  // const heightOf1Sec = timelineHeightPx / timelineDuration;
  // const heightOf1Sec = TIMELINE_STEP_HEIGHT / stepDuration;
  for (const [i, focus] of (workspaceFocusTimeline ?? []).entries()) {
    let offsetPx = 0;
    const lastLineFocus = lineFocusTimeline.at(-1);
    const nextFocusClock = workspaceFocusTimeline?.[i + 1]?.clock ?? sessionDuration;
    if (lastLineFocus) {
      // The following:

      // | first line
      // | | second line
      // | |
      //   |
      //
      // must be turned into this:
      //
      // | first line
      // | |
      // | |
      //   | second line

      const lastLineBottomPx = lastLineFocus.clockRange.start * pxToSecRatio + TRACK_HEIGHT_PX;
      const lineOriginalTopPx = focus.clock * pxToSecRatio;
      const lineOriginalBottomPx = nextFocusClock * pxToSecRatio;

      const availableSpace = lineOriginalBottomPx - lastLineBottomPx;
      const requiredSpace = TRACK_HEIGHT_PX + TRACK_MIN_GAP_PX;

      if (availableSpace < requiredSpace) continue;

      const lineTopPx = Math.max(lastLineBottomPx + TRACK_MIN_GAP_PX, lineOriginalTopPx);
      offsetPx = lineTopPx - lineOriginalTopPx;
    }

    lineFocusTimeline.push({ text: focus.text, offsetPx, clockRange: { start: focus.clock, end: nextFocusClock } });
  }

  const documentFocusTimeline: { uri: string; clockRange: t.ClockRange }[] = [];
  for (const [i, focus] of (workspaceFocusTimeline ?? []).entries()) {
    const lastDocumentFocus = documentFocusTimeline.at(-1);
    const nextFocusClock = workspaceFocusTimeline?.[i + 1]?.clock ?? sessionDuration;

    if (lastDocumentFocus && lastDocumentFocus.uri === focus.uri) {
      lastDocumentFocus.clockRange.end = nextFocusClock;
    } else {
      documentFocusTimeline.push({ uri: focus.uri, clockRange: { start: focus.clock, end: nextFocusClock } });
    }
  }

  return (
    <div className="editor-track">
      {documentFocusTimeline.map(documentFocus => {
        function documentFocusClicked(e: React.MouseEvent) {
          if (e.shiftKey) {
            extendSelection(documentFocus.clockRange.start);
          } else {
            setSelection(
              {
                type: 'editor',
                anchor: documentFocus.clockRange.start,
                focus: documentFocus.clockRange.end,
              },
              { sync: e.ctrlKey || e.metaKey },
            );
          }
        }

        const style = {
          top: `${(documentFocus.clockRange.start / timelineDuration) * 100}%`,
          bottom: `calc(100% - ${(documentFocus.clockRange.end / timelineDuration) * 100}%)`,
          minHeight: `${TRACK_HEIGHT_PX}px`,
        };
        return (
          <div className="document-focus" style={style} onClick={documentFocusClicked}>
            <p>{path.basename(URI.parse(documentFocus.uri).fsPath)}</p>
            {/*path.getUriShortNameOpt(documentFocus.uri) || 'unknown file'*/}
          </div>
        );
      })}
      {lineFocusTimeline.map(lineFocus => {
        function lineFocusClicked(e: React.MouseEvent) {
          if (e.shiftKey) {
            extendSelection(lineFocus.clockRange.start);
          } else {
            setSelection(
              { type: 'editor', anchor: lineFocus.clockRange.start, focus: lineFocus.clockRange.end },
              { sync: e.ctrlKey || e.metaKey },
            );
          }
        }
        const style = {
          top: `calc(${(lineFocus.clockRange.start / timelineDuration) * 100}% + ${lineFocus.offsetPx}px)`,
          // paddingTop: `${lineFocus.offsetPx }px`,
          bottom: `calc(100% - ${(lineFocus.clockRange.end / timelineDuration) * 100}%)`,
          minHeight: `${TRACK_HEIGHT_PX}px`,
        };
        return (
          <div className="line-focus" style={style}>
            <p onClick={lineFocusClicked}>{lineFocus.text || '<empty>'}</p>
          </div>
        );
      })}
    </div>
  );
}

// const EDITOR_TRACK_COLUMN_COUNT = 2;
// class EditorTrackUI extends React.Component<EditorTrackUIProps> {
//   render() {
//     const { timelineDuration } = this.props;
//     const columns: h.JSX.Element[][] = _.times(EDITOR_TRACK_COLUMN_COUNT, () => []);

//     const eventGroups = this.groupEditorEvents();

//     for (const [i, g] of eventGroups.entries()) {
//       const style = {
//         top: `${(g.events[0].clock / timelineDuration) * 100}%`,
//         bottom: `calc(100% - ${(g.events.at(-1)!.clock / timelineDuration) * 100}%)`,
//       };

//       let text = '';
//       if (g.type === 'textChange') {
//         text = g.events
//           .flatMap(e => e.contentChanges.map(cc => cc.text))
//           .join('')
//           .replace(/\n+/g, '\n')
//           .trim();
//       }

//       const uri = g.events.at(-1)?.uri;
//       let p: t.Path | undefined;
//       let basename: string | undefined;

//       if (uri) {
//         p = path.getUriPathOpt(uri);
//         basename = p && path.basename(p);
//         basename ??= path.getUntitledUriNameOpt(uri);
//       }

//       const title = [p, text].filter(Boolean).join('\n');

//       let label = '';
//       let icon = '';
//       if (g.type === 'documentChange') {
//         label = basename || 'document';
//         icon = 'codicon-file';
//       } else {
//         label = text || 'text';
//       }

//       const elem = (
//         <div className={`track ${g.type}`} title={title} style={style}>
//           <p>
//             {icon && <span className={`codicon va-middle m-right_small ${icon}`} />}
//             {label}
//           </p>
//         </div>
//       );
//       columns[i % columns.length].push(elem);
//     }

//     return (
//       <div className="editor-track">
//         {columns.map(column => (
//           <div className="column">{column}</div>
//         ))}
//       </div>
//     );
//   }
// }

type MarkerProps = {
  id: string;
  type: MarkerType;
  clock: number;
  timelineDuration: number;
  label?: React.ReactNode;
  buttons?: React.ReactNode[];
  hideTime?: boolean;
  active?: boolean;
  draggable?: boolean;
  onClick?: (e: React.MouseEvent) => any;
  onDragStart?: (e: React.DragEvent) => any;
  onDragEnd?: (e: React.DragEvent) => any;
  onDrag?: (e: React.DragEvent) => any;
  markerDrag?: TimelineDrag<MarkerDragLoad>;
  // ref: RefObject<HTMLElement>;
};
const MarkerUI = forwardRef(function MarkerUI(props: MarkerProps, ref: React.Ref<any>) {
  let clock = props.clock;

  // If marker changes in the backend, there might be a flash of old marker.
  // So we make sure that the marker is exactly the same before applying the markerDrag offset.
  if (props.id === props.markerDrag?.load.id && props.clock === props.markerDrag.load.initClock) {
    clock = getClockOfTimelineDrag(props.clock, props.markerDrag);
  }

  const style = {
    top: `${(clock / props.timelineDuration) * 100}%`,
  };
  return (
    <div
      ref={ref}
      id={`marker_${props.id}`}
      className={cn('marker', `marker_${props.type}`, props.active && 'marker_active', props.draggable && 'draggable')}
      style={style}
      onClick={props.onClick}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      onDrag={props.onDrag}
      draggable={props.draggable}
    >
      {!props.hideTime && (
        <div className="time">
          {lib.formatTimeSeconds(clock)}
          {/*marker.label ? ' ' + marker.label : ''*/}
        </div>
      )}
      {(props.label || props.buttons) && (
        <div className="content">
          {props.label && <div className="label">{props.label}</div>}
          {!_.isEmpty(props.buttons) && <div className="buttons">{props.buttons}</div>}
        </div>
      )}
    </div>
  );
});

function RangeSelection(props: { timelineDuration: number; range: t.ClockRange }) {
  const style = {
    top: `${(props.range.start / props.timelineDuration) * 100}%`,
    height: `${((props.range.end - props.range.start) / props.timelineDuration) * 100}%`,
  };
  return <div className="range-selection" style={style} />;
}

function SpeedControlPopover(
  props: PopoverProps & { title: string; onConfirm: (factor: number, adjustMediaTracks: boolean) => any },
) {
  const [factor, setFactor] = useState(2);
  const [adjustMediaTracks, setAdjustMediaTracks] = useState(true);
  return (
    <Popover {...props}>
      <form className="recorder-popover-form">
        <label className="label" htmlFor="speed-control-slider">
          {props.title} by {factor}x
        </label>
        <input
          type="range"
          id="speed-control-slider"
          min={1}
          max={10}
          step={0.1}
          value={factor}
          onChange={e => setFactor(Number(e.currentTarget!.value))}
          autoFocus
        />
        <VSCodeCheckbox
          checked={adjustMediaTracks}
          onChange={e => setAdjustMediaTracks((e.currentTarget as HTMLInputElement).checked)}
          title="If set, media tracks that start *after* this point will be shifted"
        >
          Shift subsequent media tracks
        </VSCodeCheckbox>
        <VSCodeButton appearance="primary" onClick={e => props.onConfirm(factor, adjustMediaTracks)}>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function MergePopover(props: PopoverProps & { onConfirm: (adjustMediaTracks: boolean) => any }) {
  const [adjustMediaTracks, setAdjustMediaTracks] = useState(true);
  return (
    <Popover {...props}>
      <form className="recorder-popover-form">
        <label className="label">Merge</label>
        <VSCodeCheckbox
          checked={adjustMediaTracks}
          onChange={e => setAdjustMediaTracks((e.currentTarget as HTMLInputElement).checked)}
          title="If set, media tracks that start *after* this point will be pulled up"
        >
          Shift subsequent media tracks
        </VSCodeCheckbox>
        <VSCodeButton appearance="primary" onClick={e => props.onConfirm(adjustMediaTracks)}>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function InsertGapPopover(props: PopoverProps & { onConfirm: (dur: number, adjustMediaTracks: boolean) => any }) {
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [adjustMediaTracks, setAdjustMediaTracks] = useState(true);
  return (
    <Popover {...props}>
      <form className="recorder-popover-form">
        <label className="label" htmlFor="gap-time-minute">
          Insert gap
        </label>
        <div className="row">
          <input
            type="number"
            id="gap-time-minute"
            min={0}
            max={60}
            step={1}
            value={minutes}
            placeholder="minutes"
            onChange={e => setMinutes(e.currentTarget.value)}
          />
          <input
            type="number"
            id="gap-time-seconds"
            min={0}
            max={59}
            step={1}
            value={seconds}
            placeholder="seconds"
            onChange={e => setSeconds(e.currentTarget.value)}
          />
        </div>
        <VSCodeCheckbox
          checked={adjustMediaTracks}
          onChange={e => setAdjustMediaTracks((e.currentTarget as HTMLInputElement).checked)}
          title="If set, media tracks that start *after* this point will be pushed down"
        >
          Shift subsequent media tracks
        </VSCodeCheckbox>
        <VSCodeButton
          appearance="primary"
          onClick={e => {
            if (/[^0-9]/.test(minutes) || /[^0-9]/.test(seconds)) return;
            props.onConfirm(Number(minutes || '0') * 60 + Number(seconds || '0'), adjustMediaTracks);
          }}
        >
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function CropPopover(props: PopoverProps & { onConfirm: (adjustMediaTracks: boolean) => any }) {
  const [adjustMediaTracks, setAdjustMediaTracks] = useState(true);
  return (
    <Popover {...props}>
      <form className="recorder-popover-form">
        <label className="label">Crop</label>
        <VSCodeCheckbox
          checked={adjustMediaTracks}
          onChange={e => setAdjustMediaTracks((e.currentTarget as HTMLInputElement).checked)}
          title="If set, media tracks that start *after* this point will be deleted"
        >
          Delete subsequent media tracks
        </VSCodeCheckbox>
        <VSCodeButton appearance="primary" onClick={e => props.onConfirm(adjustMediaTracks)}>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function ChapterPopover(
  props: PopoverProps & {
    clock?: number;
    chapter?: t.TocItem;
    index?: number;
    onConfirm: (title: string, index?: number) => any;
  },
) {
  const [title, setTitle] = useState(props.chapter?.title ?? '');

  function keyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirm();
  }

  function confirm() {
    props.onConfirm(title.trim(), props.index);
  }

  useEffect(() => {
    setTitle(props.chapter?.title ?? '');
  }, [props.popover.isOpen, props.chapter?.title]);

  return (
    <Popover {...props} className="chapter-popover">
      <form className="recorder-popover-form">
        <VSCodeTextArea
          className="title"
          rows={2}
          resize="vertical"
          value={title}
          onInput={e => setTitle((e.currentTarget as HTMLTextAreaElement).value)}
          placeholder="Enter chapter title"
          onKeyDown={keyDown}
          autoFocus
        >
          Chapter at {props.clock ? lib.formatTimeSeconds(props.clock) : ''}
        </VSCodeTextArea>
        <VSCodeButton appearance="primary" onClick={confirm}>
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function roundTo(value: number, to: number) {
  assert(to > 0);
  return Math.floor((value + to - 1) / to) * to;
}

function getClockRangeOfTrackDrag(trackDrag: TimelineDrag<t.RangedTrack>): t.ClockRange {
  const { clockRange } = trackDrag.load;
  const start = getClockOfTimelineDrag(clockRange.start, trackDrag);
  const end = start + clockRange.end - clockRange.start;
  return { start, end };
}

function getClockRangeOfTrackExtendDrag(trackDrag: TimelineDrag<t.RangedTrack>): t.ClockRange {
  const { clockRange } = trackDrag.load;
  return { start: clockRange.start, end: getClockOfTimelineDrag(clockRange.end, trackDrag) };
}

function getClockOfTimelineDrag(baseClock: number, markerDrag: TimelineDrag<any>): number {
  return Math.max(0, baseClock + markerDrag.curClockUnderMouse - markerDrag.startClockUnderMouse);
}

// function getClocksFromSelection(selection: Selection | undefined, session: t.SessionUIState): {start: number ; end: number; focus?: number; anchor?: number} | undefined {
//   if (selection) {
//     switch (selection.type) {
//       case 'editor':
//         return {start: Math.min(selection.anchor, selection.focus), end: Math.max(selection.anchor, selection.focus), focus: selection.focus, anchor: selection.anchor}
//       case 'track': {
//         switch (selection.trackType) {
//           case 'audio':
//           case 'video': {
//             const track = session.audioTracks?.find(x => x.id === selection.id) ?? session.videoTracks?.find(x => x.id === selection.id)
//             return track?.clockRange
//           }
//             case 'image':
//             throw new Error('TODO');
//           default:
//             throw new Error('Unknown track type');
//         }
//       }
//       case 'chapter':
//         return {start: selection.clock, end: selection.clock};
//       default:
//         lib.unreachable(selection, 'unknown selection');
//     }
//   }
// }

// function getEditorSelectionFocus(selection?: Selection): number | undefined {
//   if (selection?.type === 'editor') return selection.focus;
// }

function getNonEmptyEditorSelection(selection?: t.RecorderSelection): t.ClockRange | undefined {
  if (selection?.type === 'editor' && selection.focus !== selection.anchor) {
    return {
      start: Math.min(selection.focus, selection.anchor),
      end: Math.max(selection.focus, selection.anchor),
    };
  }
}

function parseYoutubeId(value: string) {
  return value.match(/(^|\/|=)([A-Za-z0-9_-]{11})($|\/|&|\?|#)/)?.[2];
}
