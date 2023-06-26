// const vscode = acquireVsCodeApi();
// const oldState = vscode.getState() || { colors: [] };
// vscode.setState({ colors: colors });

// window.addEventListener('message', event => {
//   const message = event.data; // The json data that the extension sent
//   switch (message.type) {
//   }
// });

// vscode.postMessage({ type: 'colorSelected', value: color });

function main() {
  var video = document.querySelector('#videoElement');

  if (navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then(function (stream) {
        video.srcObject = stream;
      })
      .catch(function (error) {
        console.error(error);
      });
  }

  function stop(e) {
    var stream = video.srcObject;
    var tracks = stream.getTracks();

    for (var i = 0; i < tracks.length; i++) {
      var track = tracks[i];
      track.stop();
    }

    video.srcObject = null;
  }

  window.stop = stop;
}

main();
