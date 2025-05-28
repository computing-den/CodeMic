import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import CodeMic from '../extension/codemic';
// import * as myExtension from '../extension';

suite('Extension Test Suite 2', () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage('All tests done!!!');
  });

  test('CodeMic extension activates and registers view 2', async () => {
    await getCodeMicExtension()?.activate();
    assert.ok(getCodeMicExtension()?.isActive);
  });

  test('Open CodeMic view 2', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.codemic-view-container');
    await vscode.commands.executeCommand('codemic-view.focus');

    assert.ok(getCodeMic()?.context.webviewProvider.visible);
  });

  test('Sample test 2', async () => {
    vscode.window.showInformationMessage('Testing!!!');
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    // await new Promise(resolve => setTimeout(resolve, 50_000));
  });
});

function getCodeMic(): CodeMic | undefined {
  return getCodeMicExtension()?.exports;
}

function getCodeMicExtension(): vscode.Extension<CodeMic> | undefined {
  return vscode.extensions.getExtension<CodeMic>('ComputingDen.codemic');
}
