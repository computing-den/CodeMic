import * as t from './types';

export default function editorEventStepperDispatch(
  stepper: t.EditorEventStepper,
  e: t.EditorEvent,
  direction: t.Direction,
  uriSet?: t.UriSet,
): Promise<void> {
  switch (e.type) {
    case 'textChange':
      return stepper.applyTextChangeEvent(e, direction, uriSet);
    case 'openTextDocument':
      return stepper.applyOpenTextDocumentEvent(e, direction, uriSet);
    case 'showTextEditor':
      return stepper.applyShowTextEditorEvent(e, direction, uriSet);
    case 'select':
      return stepper.applySelectEvent(e, direction, uriSet);
    case 'scroll':
      return stepper.applyScrollEvent(e, direction, uriSet);
    case 'save':
      return stepper.applySaveEvent(e, direction, uriSet);
  }
}
