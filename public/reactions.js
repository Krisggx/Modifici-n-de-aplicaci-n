(() => {
  const role = document.currentScript.dataset.role;
  const player = document.getElementById('player');

  if (!player || document.getElementById('reactionBar')) return;
  if (!['emisor', 'receptor'].includes(role)) return;

  const REACTIONS = [
    { key: 'heart', emoji: '❤️', label: 'Me encanta' },
    { key: 'like', emoji: '👍', label: 'Me gusta' },
    { key: 'laugh', emoji: '😂', label: 'Me divierte' },
    { key: 'wow', emoji: '😮', label: 'Me asombra' },
    { key: 'fire', emoji: '🔥', label: 'Está increíble' }
  ];

  const reactionsByKey = new Map(
    REACTIONS.map(reaction => [reaction.key, reaction])
  );

  // Evita saturar Firebase y la pantalla.
  const COOLDOWN_MS = 300;
  const MAX_FLOATING = 40;

  // Capa animada encima del video. No bloquea sus controles.
  const layer = document.createElement('div');

  layer.className = 'reaction-layer';
  layer.setAttribute('aria-hidden', 'true');
  player.appendChild(layer);

  // Barra de reacciones debajo del reproductor.
  const bar = document.createElement('div');

  bar.id = 'reactionBar';
  bar.className = 'reaction-bar';

  bar.innerHTML = `
    <div class="reaction-heading">
      <span class="eyebrow">REACCIONES EN VIVO</span>
      <span class="reaction-total" id="reactionTotal">0</span>
    </div>

    <div
      class="reaction-buttons"
      role="group"
      aria-label="Enviar una reacción"
    ></div>

    <p class="reaction-hint" id="reactionHint" role="status"></p>
  `;

  player.insertAdjacentElement('afterend', bar);

  const get = id => document.getElementById(id);
  const buttonGroup = bar.querySelector('.reaction-buttons');
  const buttons = new Map();

  for (const reaction of REACTIONS) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'reaction-button';
    button.dataset.reaction = reaction.key;
    button.disabled = true;
    button.title = reaction.label;
    button.setAttribute('aria-label', reaction.label);

    const emoji = document.createElement('span');
    emoji.className = 'reaction-emoji';
    emoji.textContent = reaction.emoji;
    emoji.setAttribute('aria-hidden', 'true');

    const count = document.createElement('span');
    count.className = 'reaction-count';
    count.textContent = '0';

    button.append(emoji, count);
    buttonGroup.appendChild(button);

    buttons.set(reaction.key, { button, count });
  }

  if (
    typeof db === 'undefined' ||
    typeof ROOM_PATH === 'undefined'
  ) {
    get('reactionHint').textContent =
      'No se pudo cargar Firebase. Revisa la configuración.';

    return;
  }

  const room = db.ref(ROOM_PATH);

  // Identificador local de este navegador.
  const senderId = room.push().key;

  let active = false;
  let online = false;
  let sessionId = null;
  let boundSession = null;

  let eventsQuery = null;
  let countsRef = null;

  let lastSentAt = 0;
  let readError = '';
  let sendError = '';

  // Mismo criterio que el chat: solo participa quien está en el directo.
  function participating() {
    if (role === 'emisor') {
      const button = get('stopBtn');

      return Boolean(
        button &&
        !button.disabled &&
        typeof localStream !== 'undefined' &&
        localStream
      );
    }

    return Boolean(
      typeof pc !== 'undefined' &&
      pc &&
      pc.connectionState === 'connected'
    );
  }

  function eligible() {
    return Boolean(active && sessionId && participating());
  }

  function canReact() {
    return Boolean(
      eligible() &&
      online &&
      eventsQuery &&
      !readError
    );
  }

  function formatCount(value) {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1).replace('.0', '')}k`;
    }

    return String(value);
  }

  // Crea un emoji que sube y se desvanece sobre el video.
  function spawn(reaction, mine) {
    if (document.hidden) return;

    while (layer.childElementCount >= MAX_FLOATING) {
      layer.firstElementChild.remove();
    }

    const element = document.createElement('span');

    element.className = mine
      ? 'floating-reaction is-mine'
      : 'floating-reaction';

    element.textContent = reaction.emoji;

    const rise = Math.max(player.clientHeight * 0.8, 120);

    element.style.setProperty('--x', `${68 + Math.random() * 24}%`);
    element.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 50}px`);
    element.style.setProperty('--size', `${28 + Math.random() * 18}px`);
    element.style.setProperty('--rise', `${rise}px`);
    element.style.setProperty('--duration', `${2.4 + Math.random() * 1.2}s`);

    const remove = () => element.remove();

    element.addEventListener('animationend', remove);

    // Respaldo si el navegador no ejecuta la animación.
    setTimeout(remove, 5000);

    layer.appendChild(element);
  }

  function showCounts(snapshot) {
    const counts = snapshot.val() || {};
    let total = 0;

    for (const [key, item] of buttons) {
      const value = Number.isFinite(counts[key])
        ? Math.max(0, counts[key])
        : 0;

      total += value;
      item.count.textContent = formatCount(value);
    }

    get('reactionTotal').textContent = formatCount(total);
  }

  function handleError(error) {
    console.error('Lectura de reacciones:', error);

    readError =
      'Firebase no permite leer las reacciones. ' +
      'Revisa los permisos de esta sala.';

    updateControls();
  }

  function onReaction(snapshot) {
    const data = snapshot.val();

    if (!data || typeof data.key !== 'string') return;

    const reaction = reactionsByKey.get(data.key);

    if (reaction) {
      spawn(reaction, data.senderId === senderId);
    }
  }

  function detach() {
    if (eventsQuery) eventsQuery.off('child_added', onReaction);
    if (countsRef) countsRef.off('value', showCounts);

    eventsQuery = null;
    countsRef = null;
    boundSession = null;
    readError = '';

    layer.replaceChildren();

    showCounts({ val: () => null });
  }

  function attach(id) {
    detach();

    boundSession = id;

    const base = room.child('reactions').child(id);

    // Solo reproduce las reacciones enviadas desde este momento.
    eventsQuery = base
      .child('events')
      .orderByKey()
      .startAt(room.push().key)
      .limitToLast(50);

    countsRef = base.child('counts');

    eventsQuery.on('child_added', onReaction, handleError);
    countsRef.on('value', showCounts, handleError);
  }

  function updateControls() {
    const available = canReact();

    for (const { button } of buttons.values()) {
      button.disabled = !available;
    }

    bar.classList.toggle('is-ready', available);

    let hint = role === 'emisor'
      ? 'Tu audiencia puede reaccionar en tiempo real.'
      : 'Toca un emoji para reaccionar en tiempo real.';

    if (readError) {
      hint = readError;
    } else if (!online) {
      hint = 'Reacciones sin conexión.';
    } else if (!active || !sessionId) {
      hint = 'Las reacciones se activan cuando comienza el directo.';
    } else if (!participating()) {
      hint = role === 'emisor'
        ? 'Inicia la transmisión para ver las reacciones.'
        : 'Conéctate al directo para reaccionar.';
    } else if (sendError) {
      hint = sendError;
    }

    if (get('reactionHint').textContent !== hint) {
      get('reactionHint').textContent = hint;
    }
  }

  function sync() {
    if (eligible()) {
      if (boundSession !== sessionId) {
        attach(sessionId);
      }
    } else if (boundSession) {
      detach();
    }

    updateControls();
  }

  async function sendReaction(key) {
    const now = Date.now();

    if (!canReact() || now - lastSentAt < COOLDOWN_MS) return;

    lastSentAt = now;
    sendError = '';

    const base = room.child('reactions').child(boundSession);

    try {
      await base.child('events').push().set({
        key,
        senderId,
        role,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });

      // El contador se suma de forma segura entre varios usuarios.
      await base.child('counts').child(key).transaction(
        value => (Number.isFinite(value) ? value : 0) + 1
      );
    } catch (error) {
      console.error('Envío de reacción:', error);

      sendError =
        'No se pudo enviar la reacción. ' +
        'Revisa la conexión y los permisos.';
    }

    updateControls();
  }

  buttonGroup.addEventListener('click', event => {
    const button = event.target.closest('.reaction-button');

    if (!button || button.disabled) return;

    // Pequeño rebote como confirmación visual.
    button.classList.remove('is-pressed');
    void button.offsetWidth;
    button.classList.add('is-pressed');

    sendReaction(button.dataset.reaction);
  });

  buttonGroup.addEventListener('animationend', event => {
    event.target.classList.remove('is-pressed');
  });

  function metadataError(error) {
    console.error('Estado de reacciones:', error);
    handleError(error);
  }

  room.child('active').on(
    'value',
    snapshot => {
      active = snapshot.val() === true;
      sync();
    },
    metadataError
  );

  room.child('startedAt').on(
    'value',
    snapshot => {
      const value = snapshot.val();

      sessionId =
        typeof value === 'number' &&
        Number.isFinite(value)
          ? String(value)
          : null;

      sync();
    },
    metadataError
  );

  db.ref('.info/connected').on(
    'value',
    snapshot => {
      online = snapshot.val() === true;
      sync();
    },
    metadataError
  );

  const status = get('status');

  if (status) {
    new MutationObserver(sync).observe(status, {
      childList: true,
      subtree: true
    });
  }

  setInterval(sync, 1000);
  sync();
})();
