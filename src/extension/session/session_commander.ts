import * as t from '../../lib/types.js';
import * as lib from '../../lib/lib.js';
import assert from '../../lib/assert.js';
import type { LoadedSession } from './session.js';
import _ from 'lodash';

/**
 * We need SessionCommander because of how some commands like crop must be
 * handled. For example, if current clock is past the crop clock, we must seek
 * first (using session.rr), then crop (session.editor). When undoing that
 * operation, it must be done in reverse. So, we move the handling of these
 * commands to session_commander.ts which controls both session.editor and
 * session.rr.
 */
export default class SessionCommander {
  constructor(public session: LoadedSession) {}

  async undo() {
    if (!this.session.editor.canUndo) return;

    const cmds = Array.from(this.session.editor.undoHistoryPop()).reverse();
    for (const cmd of cmds) await this.unapplyCmd(cmd);
  }

  async redo() {
    if (!this.session.editor.canRedo) return;

    const cmds = this.session.editor.undoHistoryForward();
    for (const cmd of cmds) await this.applyCmd(cmd);
  }

  async applyInsertEvent(cmd: t.InsertEventCmd) {
    this.session.editor.applyInsertEvent(cmd);
    await this.session.rr.applyInsertEvent(cmd);
  }

  async unapplyInsertEvent(cmd: t.InsertEventCmd) {
    this.session.editor.unapplyInsertEvent(cmd);
    await this.session.rr.unapplyInsertEvent(cmd);
  }

  async applyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventCmd) {
    this.session.editor.applyUpdateTrackLastEvent(cmd);
  }

  async unapplyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventCmd) {
    this.session.editor.unapplyUpdateTrackLastEvent(cmd);
  }

  async applyInsertFocus(cmd: t.InsertFocusCmd) {
    this.session.editor.applyInsertFocus(cmd);
  }

  async unapplyInsertFocus(cmd: t.InsertFocusCmd) {
    this.session.editor.unapplyInsertFocus(cmd);
  }

  async applyUpdateLastFocus(cmd: t.UpdateLastFocusCmd) {
    this.session.editor.applyUpdateLastFocus(cmd);
  }

  async unapplyUpdateLastFocus(cmd: t.UpdateLastFocusCmd) {
    this.session.editor.unapplyUpdateLastFocus(cmd);
  }

  async applyInsertAudioTrack(cmd: t.InsertAudioTrackCmd) {
    this.session.editor.applyInsertAudioTrack(cmd);
    this.session.rr.loadAudioTrack(cmd.audioTrack);
  }

  async unapplyInsertAudioTrack(cmd: t.InsertAudioTrackCmd) {
    this.session.editor.unapplyInsertAudioTrack(cmd);
    this.session.rr.unloadAudioTrack(cmd.audioTrack.id);
  }

  async applyDeleteAudioTrack(cmd: t.DeleteAudioTrackCmd) {
    this.session.editor.applyDeleteAudioTrack(cmd);
    this.session.rr.unloadAudioTrack(cmd.audioTrack.id);
  }

  async unapplyDeleteAudioTrack(cmd: t.DeleteAudioTrackCmd) {
    this.session.editor.unapplyDeleteAudioTrack(cmd);
    this.session.rr.loadAudioTrack(cmd.audioTrack);
  }

  async applyUpdateAudioTrack(cmd: t.UpdateAudioTrackCmd) {
    this.session.editor.applyUpdateAudioTrack(cmd);
    this.session.rr.updateAudioTrack(this.session.body.audioTracks.find(t => t.id === cmd.id)!);
    await this.session.rr.fastSync();
  }

  async unapplyUpdateAudioTrack(cmd: t.UpdateAudioTrackCmd) {
    this.session.editor.unapplyUpdateAudioTrack(cmd);
    this.session.rr.updateAudioTrack(this.session.body.audioTracks.find(t => t.id === cmd.id)!);
    await this.session.rr.fastSync();
  }

  async applyInsertVideoTrack(cmd: t.InsertVideoTrackCmd) {
    this.session.editor.applyInsertVideoTrack(cmd);
    this.session.rr.loadVideoTrack(cmd.videoTrack);
    await this.session.rr.fastSync();
  }

  async unapplyInsertVideoTrack(cmd: t.InsertVideoTrackCmd) {
    this.session.editor.unapplyInsertVideoTrack(cmd);
    this.session.rr.unloadVideoTrack(cmd.videoTrack.id);
    await this.session.rr.fastSync();
  }

  async applyDeleteVideoTrack(cmd: t.DeleteVideoTrackCmd) {
    this.session.editor.applyDeleteVideoTrack(cmd);
    this.session.rr.unloadVideoTrack(cmd.videoTrack.id);
    await this.session.rr.fastSync();
  }

  async unapplyDeleteVideoTrack(cmd: t.DeleteVideoTrackCmd) {
    this.session.editor.unapplyDeleteVideoTrack(cmd);
    this.session.rr.loadVideoTrack(cmd.videoTrack);
    await this.session.rr.fastSync();
  }

  async applyUpdateVideoTrack(cmd: t.UpdateVideoTrackCmd) {
    this.session.editor.applyUpdateVideoTrack(cmd);
    this.session.rr.updateVideoTrack(this.session.body.videoTracks.find(t => t.id === cmd.id)!);
    await this.session.rr.fastSync();
  }

  async unapplyUpdateVideoTrack(cmd: t.UpdateVideoTrackCmd) {
    this.session.editor.unapplyUpdateVideoTrack(cmd);
    this.session.rr.updateVideoTrack(this.session.body.videoTracks.find(t => t.id === cmd.id)!);
    await this.session.rr.fastSync();
  }

  async applyChangeSpeed(cmd: t.ChangeSpeedCmd) {
    this.session.editor.applyChangeSpeed(cmd);
    await this.session.rr.seek(lib.calcClockAfterRangeSpeedChange(cmd.revRrClock, cmd.range, cmd.factor));
  }

  async unapplyChangeSpeed(cmd: t.ChangeSpeedCmd) {
    this.session.editor.unapplyChangeSpeed(cmd);
    await this.session.rr.seek(cmd.revRrClock);
  }

  // async merge(range: t.ClockRange) {
  //   // TODO find the current event in internal workspace and set the clock to that.
  //   // const cmd = this.session.editor.createMerge(range);
  //   // await this.applyMerge(cmd);
  // }

  async applyMerge(cmd: t.MergeCmd) {
    this.session.editor.applyMerge(cmd);
    await this.session.rr.seek(cmd.range.start);
  }

  async unapplyMerge(cmd: t.MergeCmd) {
    this.session.editor.unapplyMerge(cmd);
    await this.session.rr.seek(cmd.revRrClock);
  }

  async insertGap(clock: number, duration: number) {
    const cmd = this.session.editor.createInsertGap(clock, duration);
    await this.applyInsertGap(cmd);
  }

  async applyInsertGap(cmd: t.InsertGapCmd) {
    this.session.editor.applyInsertGap(cmd);
    await this.session.rr.seek(cmd.clock);
  }

  async unapplyInsertGap(cmd: t.InsertGapCmd) {
    this.session.editor.unapplyInsertGap(cmd);
    await this.session.rr.seek(cmd.clock);
  }

  async applyInsertChapter(cmd: t.InsertChapterCmd) {
    this.session.editor.applyInsertChapter(cmd);
  }

  async unapplyInsertChapter(cmd: t.InsertChapterCmd) {
    this.session.editor.unapplyInsertChapter(cmd);
  }

  async applyUpdateChapter(cmd: t.UpdateChapterCmd) {
    this.session.editor.applyUpdateChapter(cmd);
  }

  async unapplyUpdateChapter(cmd: t.UpdateChapterCmd) {
    this.session.editor.unapplyUpdateChapter(cmd);
  }

  async applyDeleteChapter(cmd: t.DeleteChapterCmd) {
    this.session.editor.applyDeleteChapter(cmd);
  }

  async unapplyDeleteChapter(cmd: t.DeleteChapterCmd) {
    this.session.editor.unapplyDeleteChapter(cmd);
  }

  async crop(clock: number) {
    const cmd = this.session.editor.createCrop(clock);
    await this.applyCrop(cmd);
  }

  async applyCrop(cmd: t.CropCmd) {
    if (cmd.clock < this.session.rr.clock) await this.session.rr.seek(cmd.clock);
    this.session.editor.applyCrop(cmd);
  }

  async unapplyCrop(cmd: t.CropCmd) {
    this.session.editor.unapplyCrop(cmd);
    if (cmd.clock < cmd.revRrClock) await this.session.rr.seek(cmd.revRrClock);
  }

  async applyUpdateDuration(cmd: t.UpdateDurationCmd) {
    this.session.editor.applyUpdateDuration(cmd);
    await this.session.rr.seek(cmd.duration);
  }

  async unapplyUpdateDuration(cmd: t.UpdateDurationCmd) {
    this.session.editor.unapplyUpdateDuration(cmd);
    await this.session.rr.seek(cmd.revDuration);
  }

  async applyCmd(cmd: t.Cmd) {
    switch (cmd.type) {
      case 'insertEvent':
        return this.applyInsertEvent(cmd);
      case 'updateTrackLastEvent':
        return this.applyUpdateTrackLastEvent(cmd);
      case 'insertFocus':
        return this.applyInsertFocus(cmd);
      case 'updateLastFocus':
        return this.applyUpdateLastFocus(cmd);
      case 'insertAudioTrack':
        return this.applyInsertAudioTrack(cmd);
      case 'deleteAudioTrack':
        return this.applyDeleteAudioTrack(cmd);
      case 'updateAudioTrack':
        return this.applyUpdateAudioTrack(cmd);
      case 'insertVideoTrack':
        return this.applyInsertVideoTrack(cmd);
      case 'deleteVideoTrack':
        return this.applyDeleteVideoTrack(cmd);
      case 'updateVideoTrack':
        return this.applyUpdateVideoTrack(cmd);
      case 'changeSpeed':
        return this.applyChangeSpeed(cmd);
      case 'merge':
        return this.applyMerge(cmd);
      case 'insertGap':
        return this.applyInsertGap(cmd);
      case 'insertChapter':
        return this.applyInsertChapter(cmd);
      case 'updateChapter':
        return this.applyUpdateChapter(cmd);
      case 'deleteChapter':
        return this.applyDeleteChapter(cmd);
      case 'crop':
        return this.applyCrop(cmd);
      case 'updateDuration':
        return this.applyUpdateDuration(cmd);

      default:
        lib.unreachable(cmd, 'unknown cmd type');
    }
  }

  async unapplyCmd(cmd: t.Cmd) {
    switch (cmd.type) {
      case 'insertEvent':
        return this.unapplyInsertEvent(cmd);
      case 'updateTrackLastEvent':
        return this.unapplyUpdateTrackLastEvent(cmd);
      case 'insertFocus':
        return this.unapplyInsertFocus(cmd);
      case 'updateLastFocus':
        return this.unapplyUpdateLastFocus(cmd);
      case 'insertAudioTrack':
        return this.unapplyInsertAudioTrack(cmd);
      case 'deleteAudioTrack':
        return this.unapplyDeleteAudioTrack(cmd);
      case 'updateAudioTrack':
        return this.unapplyUpdateAudioTrack(cmd);
      case 'insertVideoTrack':
        return this.unapplyInsertVideoTrack(cmd);
      case 'deleteVideoTrack':
        return this.unapplyDeleteVideoTrack(cmd);
      case 'updateVideoTrack':
        return this.unapplyUpdateVideoTrack(cmd);
      case 'changeSpeed':
        return this.unapplyChangeSpeed(cmd);
      case 'merge':
        return this.unapplyMerge(cmd);
      case 'insertGap':
        return this.unapplyInsertGap(cmd);
      case 'insertChapter':
        return this.unapplyInsertChapter(cmd);
      case 'updateChapter':
        return this.unapplyUpdateChapter(cmd);
      case 'deleteChapter':
        return this.unapplyDeleteChapter(cmd);
      case 'crop':
        return this.unapplyCrop(cmd);
      case 'updateDuration':
        return this.unapplyUpdateDuration(cmd);
      default:
        lib.unreachable(cmd, 'unknown cmd type');
    }
  }
}
