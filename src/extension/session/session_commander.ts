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

  async applyInsertEvent(cmd: t.InsertEventSessionCmd) {
    this.session.editor.applyInsertEvent(cmd);
    await this.session.rr.applyInsertEvent(cmd);
  }

  async unapplyInsertEvent(cmd: t.InsertEventSessionCmd) {
    this.session.editor.unapplyInsertEvent(cmd);
    await this.session.rr.unapplyInsertEvent(cmd);
  }

  async applyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    this.session.editor.applyUpdateTrackLastEvent(cmd);
  }

  async unapplyUpdateTrackLastEvent(cmd: t.UpdateTrackLastEventSessionCmd) {
    this.session.editor.unapplyUpdateTrackLastEvent(cmd);
  }

  async applyInsertFocus(cmd: t.InsertFocusSessionCmd) {
    this.session.editor.applyInsertFocus(cmd);
  }

  async unapplyInsertFocus(cmd: t.InsertFocusSessionCmd) {
    this.session.editor.unapplyInsertFocus(cmd);
  }

  async applyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    this.session.editor.applyUpdateLastFocus(cmd);
  }

  async unapplyUpdateLastFocus(cmd: t.UpdateLastFocusSessionCmd) {
    this.session.editor.unapplyUpdateLastFocus(cmd);
  }

  async applyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    this.session.editor.applyInsertAudioTrack(cmd);
    this.session.rr.loadAudioTrack(cmd.audioTrack);
  }

  async unapplyInsertAudioTrack(cmd: t.InsertAudioTrackSessionCmd) {
    this.session.editor.unapplyInsertAudioTrack(cmd);
    this.session.rr.unloadAudioTrack(cmd.audioTrack.id);
  }

  async applyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    this.session.editor.applyDeleteAudioTrack(cmd);
    this.session.rr.unloadAudioTrack(cmd.audioTrack.id);
  }

  async unapplyDeleteAudioTrack(cmd: t.DeleteAudioTrackSessionCmd) {
    this.session.editor.unapplyDeleteAudioTrack(cmd);
    this.session.rr.loadAudioTrack(cmd.audioTrack);
  }

  async applyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    this.session.editor.applyUpdateAudioTrack(cmd);
    await this.session.rr.fastSync();
  }

  async unapplyUpdateAudioTrack(cmd: t.UpdateAudioTrackSessionCmd) {
    this.session.editor.unapplyUpdateAudioTrack(cmd);
    await this.session.rr.fastSync();
  }

  async applyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    this.session.editor.applyInsertVideoTrack(cmd);
    this.session.rr.loadVideoTrack(cmd.videoTrack);
    await this.session.rr.fastSync();
  }

  async unapplyInsertVideoTrack(cmd: t.InsertVideoTrackSessionCmd) {
    this.session.editor.unapplyInsertVideoTrack(cmd);
    this.session.rr.unloadVideoTrack(cmd.videoTrack.id);
    await this.session.rr.fastSync();
  }

  async applyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    this.session.editor.applyDeleteVideoTrack(cmd);
    this.session.rr.unloadVideoTrack(cmd.videoTrack.id);
    await this.session.rr.fastSync();
  }

  async unapplyDeleteVideoTrack(cmd: t.DeleteVideoTrackSessionCmd) {
    this.session.editor.unapplyDeleteVideoTrack(cmd);
    this.session.rr.loadVideoTrack(cmd.videoTrack);
    await this.session.rr.fastSync();
  }

  async applyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    this.session.editor.applyUpdateVideoTrack(cmd);
    await this.session.rr.fastSync();
  }

  async unapplyUpdateVideoTrack(cmd: t.UpdateVideoTrackSessionCmd) {
    this.session.editor.unapplyUpdateVideoTrack(cmd);
    await this.session.rr.fastSync();
  }

  async applyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
    this.session.editor.applyChangeSpeed(cmd);
    await this.session.rr.seek(lib.calcClockAfterRangeSpeedChange(cmd.revRrClock, cmd.range, cmd.factor));
  }

  async unapplyChangeSpeed(cmd: t.ChangeSpeedSessionCmd) {
    this.session.editor.unapplyChangeSpeed(cmd);
    await this.session.rr.seek(cmd.revRrClock);
  }

  // async merge(range: t.ClockRange) {
  //   // TODO find the current event in internal workspace and set the clock to that.
  //   // const cmd = this.session.editor.createMerge(range);
  //   // await this.applyMerge(cmd);
  // }

  async applyMerge(cmd: t.MergeSessionCmd) {
    this.session.editor.applyMerge(cmd);
    await this.session.rr.seek(cmd.range.start);
  }

  async unapplyMerge(cmd: t.MergeSessionCmd) {
    this.session.editor.unapplyMerge(cmd);
    await this.session.rr.seek(cmd.revRrClock);
  }

  async insertGap(clock: number, duration: number) {
    const cmd = this.session.editor.createInsertGap(clock, duration);
    await this.applyInsertGap(cmd);
  }

  async applyInsertGap(cmd: t.InsertGapSessionCmd) {
    this.session.editor.applyInsertGap(cmd);
    await this.session.rr.seek(cmd.clock);
  }

  async unapplyInsertGap(cmd: t.InsertGapSessionCmd) {
    this.session.editor.unapplyInsertGap(cmd);
    await this.session.rr.seek(cmd.clock);
  }

  async crop(clock: number) {
    const cmd = this.session.editor.createCrop(clock);
    await this.applyCrop(cmd);
  }

  async applyCrop(cmd: t.CropSessionCmd) {
    if (cmd.clock < this.session.rr.clock) await this.session.rr.seek(cmd.clock);
    this.session.editor.applyCrop(cmd);
  }

  async unapplyCrop(cmd: t.CropSessionCmd) {
    this.session.editor.unapplyCrop(cmd);
    if (cmd.clock < cmd.revRrClock) await this.session.rr.seek(cmd.revRrClock);
  }

  async applyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
    this.session.editor.applyUpdateDuration(cmd);
    await this.session.rr.seek(cmd.duration);
  }

  async unapplyUpdateDuration(cmd: t.UpdateDurationSessionCmd) {
    this.session.editor.unapplyUpdateDuration(cmd);
    await this.session.rr.seek(cmd.revDuration);
  }

  async applyCmd(cmd: t.SessionCmd) {
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
      case 'crop':
        return this.applyCrop(cmd);
      case 'updateDuration':
        return this.applyUpdateDuration(cmd);

      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }

  async unapplyCmd(cmd: t.SessionCmd) {
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
      case 'crop':
        return this.unapplyCrop(cmd);
      case 'updateDuration':
        return this.unapplyUpdateDuration(cmd);
      default:
        throw new Error(`unknown cmd type: ${(cmd as any).type}`);
    }
  }
}
