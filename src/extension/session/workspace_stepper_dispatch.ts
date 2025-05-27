import * as t from '../../lib/types';

export default function workspaceStepperDispatch(
  stepper: t.WorkspaceStepper,
  e: t.EditorEvent,
  direction: t.Direction,
  uriSet?: t.UriSet,
): Promise<void> {
  switch (e.type) {
    case 'store':
      return stepper.applyStoreEvent(e, direction, uriSet);
    case 'textChange':
      return stepper.applyTextChangeEvent(e, direction, uriSet);
    case 'openTextDocument':
      return stepper.applyOpenTextDocumentEvent(e, direction, uriSet);
    case 'closeTextDocument':
      return stepper.applyCloseTextDocumentEvent(e, direction, uriSet);
    case 'showTextEditor':
      return stepper.applyShowTextEditorEvent(e, direction, uriSet);
    case 'closeTextEditor':
      return stepper.applyCloseTextEditorEvent(e, direction, uriSet);
    case 'select':
      return stepper.applySelectEvent(e, direction, uriSet);
    case 'scroll':
      return stepper.applyScrollEvent(e, direction, uriSet);
    case 'save':
      return stepper.applySaveEvent(e, direction, uriSet);
    case 'textInsert':
      return stepper.applyTextInsertEvent(e, direction, uriSet);
  }
}
