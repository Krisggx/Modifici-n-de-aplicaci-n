// Lado "receptor": se conecta a la sala de Firebase y reproduce el stream remoto del emisor.
const remoteVideo = document.getElementById('remoteVideo');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusEl = document.getElementById('status');

let pc = null; // RTCPeerConnection activa
let roomRef = null; // Referencia a Firebase para la señalización (rooms/main)
let offerListenerRef = null; // Listener de la oferta (offer) publicada por el emisor
let callerCandidatesRef = null; // Listener de los ICE candidates del emisor

function setStatus(text) {
  statusEl.textContent = text;
}

async function connect() {
  connectBtn.disabled = true;
  setStatus('Buscando emisor activo...');

  roomRef = db.ref(ROOM_PATH);

  pc = new RTCPeerConnection(RTC_CONFIG);

  // Al llegar el stream remoto, lo asigna al elemento de video.
  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setStatus('Recibiendo transmisión.');
  };

  pc.onconnectionstatechange = () => {
    setStatus('Estado de conexión: ' + pc.connectionState);
  };

  // Cada ICE candidate propio se publica en Firebase para que el emisor lo use.
  const calleeCandidatesRef = roomRef.child('calleeCandidates');
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      calleeCandidatesRef.push(event.candidate.toJSON());
    }
  };

  // Espera la oferta del emisor, genera la respuesta (answer) y la publica.
  offerListenerRef = roomRef.child('offer');
  offerListenerRef.on('value', async (snapshot) => {
    const offer = snapshot.val();
    if (offer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await roomRef.child('answer').set({ type: answer.type, sdp: answer.sdp });

      setStatus('Respuesta enviada. Conectando con el emisor...');
    }
  });

  // Escucha los ICE candidates que publica el emisor y los agrega a la conexión.
  callerCandidatesRef = roomRef.child('callerCandidates');
  callerCandidatesRef.on('child_added', (snapshot) => {
    const candidate = snapshot.val();
    if (candidate && pc) {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  disconnectBtn.disabled = false;
}

function disconnect() {
  disconnectBtn.disabled = true;

  // Deja de escuchar cambios en Firebase antes de limpiar el estado.
  if (offerListenerRef) offerListenerRef.off();
  if (callerCandidatesRef) callerCandidatesRef.off();

  if (pc) {
    pc.close();
    pc = null;
  }

  remoteVideo.srcObject = null;
  roomRef = null;

  setStatus('Desconectado.');
  connectBtn.disabled = false;
}

connectBtn.addEventListener('click', connect);
disconnectBtn.addEventListener('click', disconnect);
