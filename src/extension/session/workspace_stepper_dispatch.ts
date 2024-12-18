import * as t from '../../lib/types';

export default function workspaceStepperDispatch(
  stepper: t.WorkspaceStepper,
  e: t.EditorEvent,
  uri: string,
  direction: t.Direction,
  uriSet?: t.UriSet,
): Promise<void> {
  switch (e.type) {
    case 'init':
      return stepper.applyInitEvent(e, uri, direction, uriSet);
    case 'textChange':
      return stepper.applyTextChangeEvent(e, uri, direction, uriSet);
    case 'openTextDocument':
      return stepper.applyOpenTextDocumentEvent(e, uri, direction, uriSet);
    case 'closeTextDocument':
      return stepper.applyCloseTextDocumentEvent(e, uri, direction, uriSet);
    case 'showTextEditor':
      return stepper.applyShowTextEditorEvent(e, uri, direction, uriSet);
    case 'closeTextEditor':
      return stepper.applyCloseTextEditorEvent(e, uri, direction, uriSet);
    case 'select':
      return stepper.applySelectEvent(e, uri, direction, uriSet);
    case 'scroll':
      return stepper.applyScrollEvent(e, uri, direction, uriSet);
    case 'save':
      return stepper.applySaveEvent(e, uri, direction, uriSet);
    case 'textInsert':
      return stepper.applyTextInsertEvent(e, uri, direction, uriSet);
  }
}
