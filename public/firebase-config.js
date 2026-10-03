// Configuración de Firebase (Realtime Database se usa como servidor de señalización WebRTC)
const firebaseConfig = {
 //ingresar credenciales
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// Todas las sesiones usan el mismo "room" fijo: un emisor, un receptor.
const ROOM_PATH = 'rooms/main';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
