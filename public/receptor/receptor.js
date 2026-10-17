const remoteVideo = document.getElementById('remoteVideo');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById(
  'disconnectBtn'
);
const statusEl = document.getElementById('status');
const sourceTag = document.getElementById('sourceTag');

let pc = null;
let sourceRef = null;
let roomRef = null;
let viewerRef = null;

let offerRef = null;
let rejectedRef = null;
let errorRef = null;
let callerCandidatesRef = null;

let pendingCandidates = [];
let disconnecting = false;

function setStatus(text) {
  statusEl.textContent = text;
}

// Muestra si el emisor comparte su cámara o su pantalla.
function showSource(source) {
  if (source !== 'camera' && source !== 'screen') {
    sourceTag.hidden = true;
    return;
  }

  sourceTag.hidden = false;
  sourceTag.textContent = source === 'screen'
    ? 'PANTALLA COMPARTIDA'
    : 'CÁMARA';

  sourceTag.classList.toggle('is-screen', source === 'screen');
}

async function connect() {
  if (pc || viewerRef) return;

  connectBtn.disabled = true;
  disconnecting = false;

  setStatus('Buscando un emisor activo...');

  try {
    roomRef = db.ref(ROOM_PATH);

    const activeSnapshot = await roomRef
      .child('active')
      .once('value');

    if (!activeSnapshot.val()) {
      setStatus('No hay ningún emisor activo.');
      connectBtn.disabled = false;
      return;
    }

    pc = new RTCPeerConnection(RTC_CONFIG);

    // push() genera un identificador único para este receptor.
    viewerRef = roomRef.child('viewers').push();

    offerRef = viewerRef.child('offer');
    rejectedRef = viewerRef.child('rejected');
    errorRef = viewerRef.child('error');

    callerCandidatesRef = viewerRef.child(
      'callerCandidates'
    );

    // El emisor puede cambiar de fuente sin cortar la conexión.
    sourceRef = roomRef.child('source');

    sourceRef.on('value', (snapshot) => {
      showSource(snapshot.val());
    });

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }

      setStatus('Recibiendo transmisión.');
    };

    pc.onconnectionstatechange = () => {
      if (!pc || disconnecting) return;

      const state = pc.connectionState;
      setStatus(`Estado de conexión: ${state}`);

      if (state === 'failed') {
        disconnect(
          'La conexión falló. Intenta conectarte nuevamente.'
        );
      }
    };

    // Publica los candidatos propios de este receptor.
    pc.onicecandidate = async (event) => {
      if (!event.candidate || !viewerRef) return;

      try {
        await viewerRef
          .child('calleeCandidates')
          .push(event.candidate.toJSON());
      } catch (error) {
        console.error(
          'Error enviando candidato del receptor:',
          error
        );
      }
    };

    // Detecta si ya están ocupados los cuatro lugares.
    rejectedRef.on('value', async (snapshot) => {
      const rejection = snapshot.val();

      if (!rejection) return;

      await disconnect(
        rejection.reason ||
        'No se permitió la conexión.'
      );
    });

    errorRef.on('value', async (snapshot) => {
      const connectionError = snapshot.val();

      if (!connectionError) return;

      await disconnect(
        connectionError.message ||
        'Ocurrió un error al crear la conexión.'
      );
    });

    // Recibe los candidatos ICE exclusivos para este receptor.
    callerCandidatesRef.on(
      'child_added',
      async (snapshot) => {
        if (!pc || pc.signalingState === 'closed') return;

        const data = snapshot.val();

        if (!data) return;

        const candidate = new RTCIceCandidate(data);

        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            pendingCandidates.push(candidate);
          }
        } catch (error) {
          console.error(
            'Error agregando candidato del emisor:',
            error
          );
        }
      }
    );

    // Espera la oferta exclusiva creada para este receptor.
    offerRef.on('value', async (snapshot) => {
      const offer = snapshot.val();

      if (
        !offer ||
        !pc ||
        pc.signalingState === 'closed' ||
        pc.currentRemoteDescription
      ) {
        return;
      }

      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription(offer)
        );

        // Agrega candidatos que llegaron antes de la oferta.
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(candidate);
        }

        pendingCandidates = [];

        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);

        await viewerRef.child('answer').set({
          type: answer.type,
          sdp: answer.sdp
        });

        setStatus('Respuesta enviada. Conectando...');
      } catch (error) {
        console.error(error);

        await disconnect(
          'No se pudo establecer la conexión: ' +
          error.message
        );
      }
    });

    // Elimina este receptor si pierde conexión con Firebase.
    await viewerRef.onDisconnect().remove();

    // Al crear este dato, el emisor detectará al receptor.
    await viewerRef.child('joinedAt').set(
      firebase.database.ServerValue.TIMESTAMP
    );

    if (!viewerRef || disconnecting) return;

    setStatus('Esperando respuesta del emisor...');
    disconnectBtn.disabled = false;
  } catch (error) {
    console.error(error);

    await disconnect(
      'Error al conectarse: ' + error.message
    );
  }
}

async function disconnect(finalMessage = 'Desconectado.') {
  if (disconnecting) return;

  disconnecting = true;
  disconnectBtn.disabled = true;

  if (offerRef) offerRef.off();
  if (rejectedRef) rejectedRef.off();
  if (errorRef) errorRef.off();
  if (callerCandidatesRef) callerCandidatesRef.off();
  if (sourceRef) sourceRef.off();

  sourceRef = null;
  showSource(null);

  offerRef = null;
  rejectedRef = null;
  errorRef = null;
  callerCandidatesRef = null;

  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.onconnectionstatechange = null;

    if (pc.signalingState !== 'closed') {
      pc.close();
    }

    pc = null;
  }

  remoteVideo.srcObject = null;
  pendingCandidates = [];

  if (viewerRef) {
    const currentViewerRef = viewerRef;
    viewerRef = null;

    try {
      await currentViewerRef.onDisconnect().cancel();
      await currentViewerRef.remove();
    } catch (error) {
      console.error(
        'Error eliminando el receptor:',
        error
      );
    }
  }

  roomRef = null;

  setStatus(finalMessage);
  connectBtn.disabled = false;
  disconnecting = false;
}

connectBtn.addEventListener('click', connect);

disconnectBtn.addEventListener('click', () => {
  disconnect();
});