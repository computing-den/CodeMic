import config from './config.js';
import assert from '../lib/assert.js';
import type * as t from '../lib/types.js';
import * as lib from '../lib/lib.js';
import type { Progress } from './types.js';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import _ from 'lodash';

const execFile = promisify(child_process.execFile);

const VIDEO_SEGMENT_PROGRESS_MULTIPLIER = 0.7;
const VIDEO_MERGE_PROGRESS_MULTIPLIER = 0.3;

const VIDEO_PROGRESS_MULTIPLIER = 0.7;
const AUDIO_PROGRESS_MULTIPLIER = 0.25;
const FINAL_MERGE_PROGRESS_MULTIPLIER = 0.05;

const MIN_VIDEO_DUR = 0.1;

export async function mergeMediaTracks(
  audioTracks: t.RangedTrackFile[],
  videoTracks: t.RangedTrackFile[],
  limitRange: t.ClockRange,
  tempDir: string,
  blobDir: string,
  progress: Progress,
  abortController: AbortController,
): Promise<string | undefined> {
  const videoSegments = lib.mergeTracksByExtendingSegments(videoTracks, limitRange);

  await fs.promises.rm(tempDir, { recursive: true, force: true });
  await fs.promises.mkdir(tempDir, { recursive: true });

  const segmentFiles: string[] = [];

  // Produce video segments.
  for (const [i, seg] of videoSegments.entries()) {
    if (abortController.signal.aborted) return;

    progress.report({ message: seg.track.title });
    const file = await createVideoFromTrackSegment(seg, i, blobDir, tempDir);
    segmentFiles.push(file);

    progress.report({
      message: seg.track.title,
      increment: (1 / videoSegments.length) * VIDEO_SEGMENT_PROGRESS_MULTIPLIER * VIDEO_PROGRESS_MULTIPLIER * 100,
    });
  }

  if (abortController.signal.aborted) return;

  // Produce merged video.
  progress.report({ message: 'merge videos' });
  const mergedVideoOutFilePath = path.join(tempDir, 'merged-video.mp4');
  await concatVideos(segmentFiles, tempDir, mergedVideoOutFilePath);
  progress.report({
    message: 'merge videos',
    increment: VIDEO_MERGE_PROGRESS_MULTIPLIER * VIDEO_PROGRESS_MULTIPLIER * 100,
  });

  if (abortController.signal.aborted) return;

  progress.report({ message: 'merge audio' });
  const mergedAudioOutFilePath = path.join(tempDir, 'merged-audio.mp3');
  await mergeAudioTracks(audioTracks, limitRange, blobDir, mergedAudioOutFilePath);
  progress.report({ message: 'merge audio', increment: AUDIO_PROGRESS_MULTIPLIER * 100 });

  if (abortController.signal.aborted) return;

  progress.report({ message: 'final output' });
  const finalMergeOutputFilePath = path.join(tempDir, 'merged.mp4');
  await mergeAudioVideo(mergedAudioOutFilePath, mergedVideoOutFilePath, finalMergeOutputFilePath);
  progress.report({ message: 'Done', increment: FINAL_MERGE_PROGRESS_MULTIPLIER * 100 });

  return finalMergeOutputFilePath;
}

async function concatVideos(segmentFiles: string[], tempDir: string, finalOutFilePath: string) {
  const videoFilesStr = segmentFiles.map(f => `file ${f}`.replace(/'/g, "'\\''")).join('\n');
  const videoFilesListPath = path.join(tempDir, 'list');
  await fs.promises.writeFile(videoFilesListPath, videoFilesStr, 'utf8');

  const videoConcatArgs = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    videoFilesListPath,
    '-an', // no audio
    '-c:v',
    'libx264', // reencode video with H.264
    '-movflags',
    '+faststart',
    '-f',
    'mp4', // force MP4 container
    finalOutFilePath,
  ];
  if (config.debug) console.log('ffmpeg ' + videoConcatArgs.join(' '));
  await execFile('ffmpeg', videoConcatArgs);
}

async function mergeAudioTracks(
  audioTracks: t.RangedTrackFile[],
  limitRange: t.ClockRange,
  blobDir: string,
  mergedAudioOutFilePath: string,
) {
  // Order audio tracks by the ending.
  audioTracks = _.orderBy(audioTracks, t => t.clockRange.end, 'asc');

  // Filter out non-overlapping tracks.
  audioTracks = audioTracks.filter(t => lib.getClockRangeOverlap(t.clockRange, limitRange));

  const audioFiles: string[] = [];
  const audioFilters: string[] = [];
  for (const [i, track] of audioTracks.entries()) {
    const overlap = lib.getClockRangeOverlap(track.clockRange, limitRange)!;

    assert(track.file.type === 'blob');
    const filePath = path.join(blobDir, track.file.sha1);
    audioFiles.push(filePath);

    let trimStart = overlap.start - track.clockRange.start;
    let trimEnd = overlap.end - track.clockRange.start;
    let delay = overlap.start;
    let pad = i === audioTracks.length - 1 ? limitRange.end - overlap.end : 0;
    const filterParts = _.compact([
      `atrim=start=${trimStart}:end=${trimEnd}`,
      `asetpts=PTS-STARTPTS`,
      `adelay=${delay * 1000}:all=1`,
      pad > 0 && `apad=pad_dur=${pad}`, // pad: 0 means infinite padding in some ffmpeg builds
    ]);
    let filter = `[${i}:a] ${filterParts.join(',')} [a${i}]`;

    audioFilters.push(filter);
  }

  const mixFilter =
    _.times(audioFilters.length, i => `[a${i}]`).join('') + `amix=inputs=${audioFilters.length}:normalize=0[mix]`;
  audioFilters.push(mixFilter);

  const loudNormFilter = `[mix]loudnorm=I=-16:TP=-2:LRA=11[out]`;
  audioFilters.push(loudNormFilter);

  const audioConcatArgs = [
    ...audioFiles.flatMap(f => ['-i', f]),
    '-filter_complex',
    audioFilters.join(';'),
    '-map',
    '[out]',
    '-c:a',
    'libmp3lame',
    '-b:a',
    '192k',
    mergedAudioOutFilePath,
  ];
  if (config.debug) console.log('ffmpeg ' + audioConcatArgs.join(' '));
  await execFile('ffmpeg', audioConcatArgs);
}

async function mergeAudioVideo(audio: string, video: string, output: string) {
  // ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -c:a copy output.mp4
  const args = ['-i', video, '-i', audio, '-c:v', 'copy', '-c:a', 'copy', output];
  if (config.debug) console.log('ffmpeg ' + args.join(' '));
  await execFile('ffmpeg', args);
}

async function createVideoFromTrackSegment(
  seg: t.TrackSegment,
  i: number,
  blobDir: string,
  tempDir: string,
): Promise<string> {
  assert(seg.track.file.type === 'blob');

  const origRange = seg.track.clockRange;

  const origDur = lib.getClockRangeDur(origRange);
  const finalDur = lib.getClockRangeDur(seg.finalRange);

  let trimStart = Math.min(origDur, Math.max(0, seg.finalRange.start - origRange.start));
  let trimEnd = Math.min(origRange.end, seg.finalRange.end) - origRange.start;

  let cloneStart = Math.min(finalDur, Math.max(0, origRange.start - seg.finalRange.start));
  let cloneEnd = Math.min(finalDur, Math.max(0, seg.finalRange.end - origRange.end));

  if (trimEnd - trimStart < MIN_VIDEO_DUR) {
    trimStart -= MIN_VIDEO_DUR;
    cloneEnd = Math.max(0, cloneEnd - MIN_VIDEO_DUR);
  }
  assert(trimStart >= 0, `${seg.track.title} is too short`);

  const origFilePath = path.join(blobDir, seg.track.file.sha1);
  const outFilePath = path.join(tempDir, i + 1 + '-' + seg.track.title);

  const filter = `
      [0:v]trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS[s];
      [s]tpad=start_mode=clone:start_duration=${cloneStart}[s2];
      [s2]tpad=stop_mode=clone:stop_duration=${cloneEnd}[v]
      `;

  const args = [
    '-y',
    '-i',
    origFilePath,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outFilePath,
  ];
  if (config.debug) {
    console.log('ffmpeg ' + args.join(' '));
  }

  const { stdout, stderr } = await execFile('ffmpeg', args);
  if (config.debug && stderr.trim()) console.error(stderr);

  return outFilePath;
}
