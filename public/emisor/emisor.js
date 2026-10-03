// Lado "emisor": captura cámara/micrófono local y los transmite al receptor vía WebRTC.
const localVideo = document.getElementById('localVideo');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');

let pc = null; // RTCPeerConnection activa
let localStream = null; // Stream de cámara/micrófono local
let roomRef = null; // Referencia a Firebase para la señalización (rooms/main)
let answerListenerRef = null; // Listener de la respuesta (answer) del receptor
let calleeCandidatesRef = null; // Listener de los ICE candidates del receptor

function setStatus(text) {
  statusEl.textContent = text;
}

async function start() {
  startBtn.disabled = true;
  setStatus('Solicitando acceso a cámara y micrófono...');

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    setStatus('Error al acceder a cámara/micrófono: ' + err.message);
    startBtn.disabled = false;
    return;
  }

  localVideo.srcObject = localStream;

  roomRef = db.ref(ROOM_PATH);
  // Limpia cualquier sesión anterior antes de iniciar una nueva.
  await roomRef.remove();

  pc = new RTCPeerConnection(RTC_CONFIG);
  // Agrega las pistas de audio/video locales para que se envíen al receptor.
  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  // Cada ICE candidate propio se publica en Firebase para que el receptor lo use.
  const callerCandidatesRef = roomRef.child('callerCandidates');
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      callerCandidatesRef.push(event.candidate.toJSON());
    }
  };

  pc.onconnectionstatechange = () => {
    setStatus('Estado de conexión: ' + pc.connectionState);
  };

  // Crea y publica la oferta SDP (paso inicial del handshake WebRTC).
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await roomRef.child('offer').set({ type: offer.type, sdp: offer.sdp });

  setStatus('Oferta enviada. Esperando a que el receptor se conecte...');

  // Espera a que el receptor publique su respuesta (answer) para completar el handshake.
  answerListenerRef = roomRef.child('answer');
  answerListenerRef.on('value', async (snapshot) => {
    const answer = snapshot.val();
    if (answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      setStatus('Receptor conectado. Transmitiendo...');
    }
  });

  // Escucha los ICE candidates que publica el receptor y los agrega a la conexión.
  calleeCandidatesRef = roomRef.child('calleeCandidates');
  calleeCandidatesRef.on('child_added', (snapshot) => {
    const candidate = snapshot.val();
    if (candidate && pc) {
      pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  });

  stopBtn.disabled = false;
}

async function stop() {
  stopBtn.disabled = true;

  // Deja de escuchar cambios en Firebase antes de limpiar el estado.
  if (answerListenerRef) answerListenerRef.off();
  if (calleeCandidatesRef) calleeCandidatesRef.off();

  if (pc) {
    pc.close();
    pc = null;
  }

  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;

  // Elimina la sala para que no queden datos de la sesión anterior.
  if (roomRef) {
    await roomRef.remove();
    roomRef = null;
  }

  setStatus('Transmisión detenida.');
  startBtn.disabled = false;
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
