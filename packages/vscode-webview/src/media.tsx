import _ from 'lodash';

export enum MediaStatus {
  Init,
  Waiting,
  Ready,
  Playing,
  Error,
}

// export type Handlers = {
//   clockChanged: (clock: number) => void;
//   statusChanged: (active: boolean) => void;
// };

export default class Media {
  status: MediaStatus = MediaStatus.Init;
  private statusBeforeSeek: MediaStatus = MediaStatus.Init;

  constructor(public src: string, public clock: number, private handler: (timeMs: number) => void) {
    this.audio.addEventListener('loadstart', this.handleLoadstart);
    this.audio.addEventListener('durationchange', this.handleDurationchange);
    this.audio.addEventListener('loadedmetadata', this.handleLoadedmetadata);
    this.audio.addEventListener('loadeddata', this.handleLoadeddata);
    this.audio.addEventListener('progress', this.handleProgress);
    this.audio.addEventListener('canplay', this.handleCanplay);
    this.audio.addEventListener('canplaythrough', this.handleCanplaythrough);
    this.audio.addEventListener('suspend', this.handleSuspend);
    this.audio.addEventListener('abort', this.handleAbort);
    this.audio.addEventListener('error', this.handleError);
    this.audio.addEventListener('emptied', this.handleEmptied);
    this.audio.addEventListener('stalled', this.handleStalled);
    this.audio.addEventListener('timeupdate', this.handleTimeupdate);
    this.audio.addEventListener('playing', this.handlePlaying);
    this.audio.addEventListener('waiting', this.handleWaiting);
    this.audio.addEventListener('play', this.handlePlay);
    this.audio.addEventListener('pause', this.handlePause);
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('volumechange', this.handleVolumechange);
    this.audio.addEventListener('seeking', this.handleSeeking);
    this.audio.addEventListener('seeked', this.handleSeeked);

    this.audio.setAttribute('src', this.src);
    this.audio.volume = 1;
  }

  stop() {
    this.audio.removeEventListener('loadstart', this.handleLoadstart);
    this.audio.removeEventListener('durationchange', this.handleDurationchange);
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedmetadata);
    this.audio.removeEventListener('loadeddata', this.handleLoadeddata);
    this.audio.removeEventListener('progress', this.handleProgress);
    this.audio.removeEventListener('canplay', this.handleCanplay);
    this.audio.removeEventListener('canplaythrough', this.handleCanplaythrough);
    this.audio.removeEventListener('suspend', this.handleSuspend);
    this.audio.removeEventListener('abort', this.handleAbort);
    this.audio.removeEventListener('error', this.handleError);
    this.audio.removeEventListener('emptied', this.handleEmptied);
    this.audio.removeEventListener('stalled', this.handleStalled);
    this.audio.removeEventListener('timeupdate', this.handleTimeupdate);
    this.audio.removeEventListener('playing', this.handlePlaying);
    this.audio.removeEventListener('waiting', this.handleWaiting);
    this.audio.removeEventListener('play', this.handlePlay);
    this.audio.removeEventListener('pause', this.handlePause);
    this.audio.removeEventListener('ended', this.handleEnded);
    this.audio.removeEventListener('volumechange', this.handleVolumechange);
    this.audio.removeEventListener('seeking', this.handleSeeking);
    this.audio.removeEventListener('seeked', this.handleSeeked);
  }

  handleLoadstart = () => {
    console.log('handleLoadstart');
    // The loadstart event tells us that load process has started and the browser is connecting to the media.
    this.status = MediaStatus.Waiting;
  };

  handleDurationchange = () => {
    console.log('handleDurationchange');
    // If you just want to know as soon as the duration of your media is established, this is the event for you. This can be useful because the initial value for duration is NaN (Not a Number)
  };

  handleLoadedmetadata = () => {
    console.log('handleLoadedmetadata');
    // you can display the duration now
  };

  handleLoadeddata = () => {
    console.log('handleLoadeddata');
    // you could display the playhead now
  };

  handleProgress = () => {
    console.log('handleProgress');
    // you could let the user know the media is downloading
  };

  handleCanplay = () => {
    console.log('handleCanplay');
    // audio is ready to play
  };

  handleCanplaythrough = () => {
    console.log('handleCanplaythrough');
    // audio is ready to play all the way through
    this.status = MediaStatus.Ready;
  };

  handleSuspend = () => {
    console.log('handleSuspend');
    // Media data is no longer being fetched even though the file has not been entirely downloaded.
    this.status = MediaStatus.Error;
  };

  handleAbort = () => {
    console.log('handleAbort');
    // Media data download has been aborted but not due to an error.
    this.status = MediaStatus.Error;
  };

  handleError = (e: ErrorEvent) => {
    // An error is encountered while media data is being downloaded.
    console.error(e.error);
    console.error(e.message);
    this.status = MediaStatus.Error;
  };

  handleEmptied = () => {
    console.log('handleEmptied');
    // The media buffer has been emptied, possibly due to an error or because the load() method was invoked to reload it.
    this.status = MediaStatus.Init;
  };

  handleStalled = () => {
    console.log('handleStalled');
    // Media data is unexpectedly no longer available.
    this.status = MediaStatus.Waiting;
  };

  handleTimeupdate = () => {
    console.log('handleTimeupdate');
    // The timeupdate event is triggered every time the currentTime property changes. In practice, this occurs every 250 milliseconds. This event can be used to trigger the displaying of playback progress.
    this.status = MediaStatus.Playing;
    this.handler(this.audio.currentTime);
  };

  handlePlaying = () => {
    console.log('handlePlaying');
    // The playing event is fired after playback is first started, and whenever it is restarted. For example it is fired when playback resumes after having been paused or delayed due to lack of data.
    this.status = MediaStatus.Playing;
  };

  handleWaiting = () => {
    console.log('handleWaiting');
    // The waiting event is triggered when playback has stopped due to lack of media data, although it is expected to resume once data becomes available.
    this.status = MediaStatus.Waiting;
  };

  handlePlay = () => {
    console.log('handlePlay');
    // The play event is initiated after the play() method is returned or when the autoplay attribute has caused playback to begin. This is when the state of the media switches from paused to playing.
    this.status = MediaStatus.Playing;
  };

  handlePause = () => {
    console.log('handlePause');
    // The pause event is triggered after the pause() method is returned. This is when the states switch from playing to paused.
    this.status = MediaStatus.Ready;
  };

  handleEnded = () => {
    console.log('handleEnded');
    // The ended event is initiated when the end of the media is reached.
    this.status = MediaStatus.Ready;
  };

  handleVolumechange = () => {
    console.log('handleVolumechange');
    // The volumechange event signifies that the volume has changed; that includes being muted.
  };

  handleSeeking = () => {
    console.log('handleSeeking');
    // The seeking event is fired when media is being sought.
    this.statusBeforeSeek = this.status;
    this.status = MediaStatus.Waiting;
  };

  handleSeeked = () => {
    console.log('handleSeeked');
    // seeked occurs when the seeking attribute changes to false.
    this.status = this.statusBeforeSeek;
  };

  get audio(): HTMLAudioElement {
    return document.getElementById('audio') as HTMLAudioElement;
  }

  // TODO: audio element's start() returns a promise
  start() {
    this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  // private handle = () => {
  //   const timeMs = performance.now();
  //   this.timeMs += timeMs - this.lastTime;
  //   this.lastTime = timeMs;
  //   this.listener(this.timeMs);
  //   this.request = setTimeout(this.handle, FakeMedia.intervalMs);
  // };
}
