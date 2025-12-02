import React, {
  forwardRef,
  memo,
  Ref,
  RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
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

export type Props = {
  className?: string;
  playing: boolean;
  recording: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasEditorSelection: boolean;
  selectionStart?: number;
  selectionEnd?: number;
  editorSelectionStart?: number;
  editorSelectionEnd?: number;
  selectionType?: t.RecorderSelection['type'];
  selectedChapterTitle?: string;
  selectedChapterIndex?: number;
  onDeleteSelection?: () => void;
  selectionRef: RefObject<HTMLElement>;
  sessionHandle: string;
  sessionWorkspace: string;
};

export type RecorderToolbarHandle = {
  toggleChapterPopover: () => void;
};

const RecorderToolbar = memo(
  forwardRef<RecorderToolbarHandle, Props>(function RecorderToolbar(props, ref) {
    // console.log('Rendering RecorderToolbar');

    // Popovers.
    const forkSessionPopover = usePopover();
    const slowDownPopover = usePopover();
    const speedUpPopover = usePopover();
    const mergePopover = usePopover();
    const insertGapPopover = usePopover();
    const cropPopover = usePopover();
    const insertPopover = usePopover();
    const otherActionsPopover = usePopover();
    const chapterPopover = usePopover();

    // Refs.
    const slowDownButtonRef = useRef(null);
    const speedUpButtonRef = useRef(null);
    const mergeButtonRef = useRef(null);
    const insertGapButtonRef = useRef(null);
    const cropButtonRef = useRef(null);
    const insertButtonRef = useRef(null);
    const otherActionsButtonRef = useRef(null);

    useImperativeHandle(ref, () => ({
      toggleChapterPopover: chapterPopover.toggle,
    }));

    let editorSelectionRange: t.ClockRange | undefined;
    if (props.editorSelectionStart !== undefined && props.editorSelectionEnd !== undefined) {
      editorSelectionRange = { start: props.editorSelectionStart, end: props.editorSelectionEnd };
    }

    // const selectedChapterIndex = selection?.type === 'chapter' ? selection.index : undefined;
    // const selectedChapter = selectedChapterIndex !== undefined ? head.toc[selectedChapterIndex] : undefined;

    async function forkSession(handle: string, workspace: string) {
      await postMessage({ type: 'recorder/forkSession', handle, workspace });
    }

    async function undo() {
      await postMessage({ type: 'recorder/undo' });
    }

    async function redo() {
      await postMessage({ type: 'recorder/redo' });
    }

    async function makeTest() {
      await postMessage({ type: 'recorder/makeTest' });
    }

    async function mergeVideoAudioTracks() {
      await postMessage({ type: 'recorder/mergeVideoAudioTracks' });
    }

    async function makeClip() {
      await postMessage({ type: 'recorder/makeClip' });
    }

    async function mergeAndReplaceVideoAudioTracks() {
      await postMessage({ type: 'recorder/mergeVideoAudioTracks', deleteOld: true });
    }

    async function changeSpeed(factor: number, adjustMediaTracks: boolean) {
      assert(editorSelectionRange);
      // TODO disable speed control popover buttons till done.
      await postMessage({ type: 'recorder/changeSpeed', range: editorSelectionRange, factor, adjustMediaTracks });

      slowDownPopover.close();
      speedUpPopover.close();
    }

    function slowDown(factor: number, adjustMediaTracks: boolean) {
      return changeSpeed(1 / factor, adjustMediaTracks);
    }

    function speedUp(factor: number, adjustMediaTracks: boolean) {
      return changeSpeed(factor, adjustMediaTracks);
    }

    async function insertAudio() {
      const { uris } = await postMessage({
        type: 'showOpenDialog',
        options: {
          title: 'Select audio file',
          filters: { 'MP3 Audio': ['mp3'] },
        },
      });
      if (uris?.length === 1) {
        const clock = props.selectionStart ?? 0;
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
        const clock = props.selectionStart ?? 0;
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
        const clock = props.selectionStart ?? 0;
        await postMessage({ type: 'recorder/insertImage', uri: uris[0], clock });
      }
    }

    async function merge(adjustMediaTracks: boolean) {
      assert(editorSelectionRange);

      await postMessage({ type: 'recorder/merge', range: editorSelectionRange, adjustMediaTracks });
      mergePopover.close();
    }

    async function crop(adjustMediaTracks: boolean) {
      const clock = props.selectionEnd;
      assert(clock !== undefined);
      await postMessage({ type: 'recorder/crop', clock, adjustMediaTracks });
      cropPopover.close();
    }

    async function insertGap(dur: number, adjustMediaTracks: boolean) {
      const clock = props.selectionStart;
      assert(clock !== undefined);
      await postMessage({ type: 'recorder/insertGap', clock, dur, adjustMediaTracks });
      insertGapPopover.close();
    }

    async function insertOrUpdateChapter(title: string, index?: number) {
      if (index === undefined) {
        // insert new.
        if (title) {
          const clock = props.selectionStart;
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

    const otherActionsItems: PopoverMenuItem[] = _.compact([
      config.debug && {
        title: 'Fork session',
        icon: 'codicon codicon-repo-forked',
        disabled: props.playing || props.recording,
        onClick: forkSessionPopover.toggle,
      },
      config.debug && {
        title: 'Make clip',
        icon: 'fa-solid fa-scissors',
        disabled: props.playing || props.recording,
        onClick: makeClip,
      },
      config.debug && {
        title: 'Merge video/audio tracks',
        icon: 'fa-solid fa-link',
        disabled: props.playing || props.recording,
        onClick: mergeVideoAudioTracks,
      },
      config.debug && {
        title: 'Merge & replace video/audio tracks',
        icon: 'fa-solid fa-link',
        disabled: props.playing || props.recording,
        onClick: mergeAndReplaceVideoAudioTracks,
      },
      config.debug && {
        title: 'Make test',
        icon: 'codicon codicon-beaker',
        disabled: props.playing || props.recording,
        onClick: makeTest,
      },
    ]);

    const toolbarActions = _.compact([
      <Toolbar.Button
        title="Undo"
        icon="fa-solid fa-rotate-left"
        disabled={!props.canUndo || props.playing || props.recording}
        onClick={undo}
      />,
      <Toolbar.Button
        title="Redo"
        icon="fa-solid fa-rotate-right"
        disabled={!props.canRedo || props.playing || props.recording}
        onClick={redo}
      />,
      <Toolbar.Separator />,
      // <Toolbar.Separator />,
      <Toolbar.Button
        ref={slowDownButtonRef}
        title="Slow down"
        icon="fa-solid fa-backward"
        disabled={props.playing || props.recording || !props.hasEditorSelection}
        onClick={slowDownPopover.toggle}
      />,
      <Toolbar.Button
        ref={speedUpButtonRef}
        title="Speed up"
        icon="fa-solid fa-forward"
        disabled={props.playing || props.recording || !props.hasEditorSelection}
        onClick={speedUpPopover.toggle}
      />,
      <Toolbar.Button
        ref={mergeButtonRef}
        title="Merge"
        icon="fa-solid fa-arrows-up-to-line"
        disabled={props.playing || props.recording || !props.hasEditorSelection}
        onClick={mergePopover.toggle}
      />,
      <Toolbar.Button
        ref={insertGapButtonRef}
        title="Insert gap"
        icon="fa-solid fa-arrows-left-right-to-line icon-rotate-cw-90"
        disabled={props.playing || props.recording || props.hasEditorSelection || props.selectionStart === undefined}
        onClick={insertGapPopover.toggle}
      />,
      <Toolbar.Button
        ref={cropButtonRef}
        title="Crop"
        icon="fa-solid fa-crop-simple"
        disabled={props.playing || props.recording || props.hasEditorSelection || props.selectionEnd === undefined}
        onClick={cropPopover.toggle}
      />,
      <Toolbar.Separator />,
      <Toolbar.Button
        ref={insertButtonRef}
        title="Insert"
        icon="codicon codicon-add"
        disabled={props.playing || props.recording}
        onClick={insertPopover.toggle}
      />,
      <Toolbar.Button
        title="Delete"
        icon="codicon codicon-trash"
        disabled={
          props.playing ||
          props.recording ||
          props.hasEditorSelection ||
          (props.selectionType !== 'track' && props.selectionType !== 'chapter')
        }
        onClick={props.onDeleteSelection}
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

    const insertMenuItems: PopoverMenuItem[] = [
      {
        title: 'Insert audio',
        icon: 'codicon codicon-mic',
        disabled: props.playing || props.recording,
        onClick: insertAudio,
      },
      {
        title: 'Insert video',
        icon: 'codicon codicon-device-camera-video',
        disabled: props.playing || props.recording,
        onClick: insertVideo,
      },
      {
        title: 'Insert image',
        icon: 'codicon codicon-device-camera',
        disabled: props.playing || props.recording,
        onClick: insertImage,
      },
      {
        title: 'Insert chapter',
        icon: 'fa-solid fa-font',
        disabled: props.playing || props.recording || props.selectionStart === undefined,
        onClick: chapterPopover.toggle,
      },
    ];

    return (
      <>
        <Toolbar actions={toolbarActions} />
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
        {config.debug && (
          <ForkSessionPopover
            popover={forkSessionPopover}
            anchor={otherActionsButtonRef}
            pointOnAnchor="bottom-left"
            pointOnPopover="top-left"
            handle={props.sessionHandle}
            workspace={props.sessionWorkspace}
            onConfirm={forkSession}
          />
        )}
        {props.selectionStart !== undefined && (
          <ChapterPopover
            chapterTitle={props.selectedChapterTitle}
            index={props.selectedChapterIndex}
            popover={chapterPopover}
            onConfirm={insertOrUpdateChapter}
            anchor={props.selectionRef}
            pointOnAnchor="bottom-left"
            pointOnPopover="top-left"
            clock={props.selectionStart}
          />
        )}
      </>
    );
  }),
);

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

function ForkSessionPopover(
  props: PopoverProps & { onConfirm: (handle: string, workspace: string) => any; handle: string; workspace: string },
) {
  const [workspace, setWorkspace] = useState(`${props.workspace}_fork`);
  const [handle, setHandle] = useState(`${props.handle}_fork`);
  return (
    <Popover {...props}>
      <form className="recorder-popover-form">
        <label className="label">Fork session</label>
        <PathField
          className="subsection"
          placeholder="Workspace directory"
          value={workspace}
          onChange={setWorkspace}
          pickTitle="New workpace directory"
        >
          Workspace
        </PathField>
        <VSCodeTextField
          className="subsection"
          placeholder="A-Z a-z 0-9 - _ (e.g. my_project)"
          value={handle}
          onInput={e => {
            setHandle((e.target as HTMLInputElement).value.replace(/[^A-Za-z0-9_-]/g, ''));
          }}
        >
          Handle
        </VSCodeTextField>
        <VSCodeButton
          appearance="primary"
          onClick={e => {
            if (!handle || !workspace || workspace === '/') return;
            props.onConfirm(handle, workspace);
          }}
        >
          OK
        </VSCodeButton>
      </form>
    </Popover>
  );
}

function ChapterPopover(
  props: PopoverProps & {
    chapterTitle?: string;
    clock?: number;
    index?: number;
    onConfirm: (title: string, index?: number) => any;
  },
) {
  const [title, setTitle] = useState(props.chapterTitle ?? '');

  function keyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirm();
  }

  function confirm() {
    props.onConfirm(title.trim(), props.index);
  }

  useEffect(() => {
    setTitle(props.chapterTitle ?? '');
  }, [props.popover.isOpen, props.chapterTitle]);

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

export default RecorderToolbar;
