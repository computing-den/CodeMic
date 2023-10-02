import * as t from './types';

export default abstract class PlaybackEventStepper {
  applyPlaybackEvent(e: t.PlaybackEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void> {
    switch (e.type) {
      case 'textChange':
        return this.applyTextChangeEvent(e, direction, uriSet);
      case 'openTextDocument':
        return this.applyOpenTextDocumentEvent(e, direction, uriSet);
      case 'showTextEditor':
        return this.applyShowTextEditorEvent(e, direction, uriSet);
      case 'select':
        return this.applySelectEvent(e, direction, uriSet);
      case 'scroll':
        return this.applyScrollEvent(e, direction, uriSet);
      case 'save':
        return this.applySaveEvent(e, direction, uriSet);
    }
  }

  abstract applyTextChangeEvent(e: t.TextChangeEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void>;
  abstract applyOpenTextDocumentEvent(
    e: t.OpenTextDocumentEvent,
    direction: t.Direction,
    uriSet?: t.UriSet,
  ): Promise<void>;
  abstract applyShowTextEditorEvent(e: t.ShowTextEditorEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void>;
  abstract applySelectEvent(e: t.SelectEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void>;
  abstract applyScrollEvent(e: t.ScrollEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void>;
  abstract applySaveEvent(e: t.SaveEvent, direction: t.Direction, uriSet?: t.UriSet): Promise<void>;
}
