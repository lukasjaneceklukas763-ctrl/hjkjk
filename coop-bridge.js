(() => {
  "use strict";

  const ROOM_PREFIX = "madness-nexus-true-coop-v12-admin-spells";
  const GAME_WIDTH = 850;
  const GAME_HEIGHT = 530;
  const INPUT_TIMEOUT_MS = 800;
  const INPUT_SEND_MS = 34;
  const FALLBACK_INPUT_MS = 120;
  const SNAPSHOT_SEND_MS = 50;
  const FALLBACK_SNAPSHOT_MS = 250;
  const NPC_STALE_MS = 2500;
  const SESSION_HEARTBEAT_MS = 800;
  const OFFER_RETRY_MS = 1800;
  const CONTROL_QUEUE_LIMIT = 32;

  const state = {
    role: "",
    room: "",
    clientId: randomId("client"),
    sessionId: "",
    localNick: "",
    remoteNick: "",
    supabase: null,
    channel: null,
    channelReady: false,
    peerPresent: false,
    stopped: false,

    pc: null,
    offerId: "",
    creatingOffer: false,
    offerRetryTimer: 0,
    pendingIce: [],
    controlChannel: null,
    stateChannel: null,
    connected: false,

    controlSeq: 0,
    seenControlIds: new Set(),
    controlQueue: new Map(),

    localCharacterReady: false,
    remoteCharacterReady: false,
    autoMenuPending: false,
    autoMenuConsumed: false,
    arenaLaunched: false,
    arenaLaunchPending: false,
    arenaLaunchConsumed: false,
    arenaLaunchAck: false,
    arenaStartWave: 0,
    launchId: "",
    lastCompletedLaunchId: "",
    arenaMenuRevision: 0,

    localInput: blankInput(),
    remoteInput: blankInput(),
    remoteInputAt: 0,
    localInputVersion: 0,
    lastSentVersion: -1,
    lastFallbackInputAt: 0,

    inputTimer: 0,
    snapshotTimer: 0,
    sessionTimer: 0,
    lastFallbackSnapshotAt: 0,
    snapshotSeq: 0,
    remoteSnapshotSeq: -1,
    hostPlayers: Object.create(null),
    hostNpcs: new Map(),
    remotePlayers: Object.create(null),
    remoteNpcs: Object.create(null),
    localAppearance: null,
    localAppearanceSignature: "",
    remoteAppearance: null,
    remoteAppearanceVersion: 0,
    deliveredAppearanceVersion: 0,
    adminPresetQueue: "",
    adminPresetApplied: "",
    adminSpellQueue: 0,
    adminSpellQueueAt: 0,
    adminSpellLastCastAt: 0,
    remoteSpellQueue: 0,
    remoteSpellQueueAt: 0,
    remoteSpellPreset: "",

    localProfile: null,
    localProfileSignature: "",
    remoteProfile: null,
    remoteProfileVersion: 0,
    guestAuthoritativeProfile: null,
    guestCorrectionPending: false,
    guestProfileAcceptedAt: 0,
    antiCheatWarnings: 0,

    rosterTemp: [],
    localHires: [],
    localHireSignature: "",
    remoteHires: [],
    localRosterRevision: 0,
    remoteRosterRevision: 0,
    localRosterReady: false,
    remoteRosterReady: false
  };

  function randomId(prefix = "id") {
    const values = new Uint32Array(3);
    crypto.getRandomValues(values);
    return `${prefix}-${Array.from(values, (value) => value.toString(36)).join("")}`;
  }

  function blankInput() {
    return {
      up: false,
      down: false,
      left: false,
      right: false,
      fire: false,
      guard: false,
      reload: false,
      pickup: false,
      slowmo: false,
      aimX: GAME_WIDTH / 2,
      aimY: GAME_HEIGHT / 2
    };
  }

  function normalizeStartWave(value) {
    const wave = Number(value);
    return Number.isFinite(wave) ? Math.max(0, Math.floor(wave)) : 0;
  }

  function normalizeInput(value) {
    const src = value && typeof value === "object" ? value : {};
    const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
    return {
      up: Boolean(src.up),
      down: Boolean(src.down),
      left: Boolean(src.left),
      right: Boolean(src.right),
      fire: Boolean(src.fire),
      guard: Boolean(src.guard),
      reload: Boolean(src.reload),
      pickup: Boolean(src.pickup),
      slowmo: Boolean(src.slowmo),
      aimX: Math.max(-2000, Math.min(3000, number(src.aimX, GAME_WIDTH / 2))),
      aimY: Math.max(-2000, Math.min(3000, number(src.aimY, GAME_HEIGHT / 2)))
    };
  }

  function normalizeCharacter(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
    return {
      x: number(source.x),
      y: number(source.y),
      health: number(source.health),
      healthMax: number(source.healthMax, 1),
      facing: typeof source.facing === "number" ? number(source.facing) : String(source.facing || "right"),
      dir: typeof source.dir === "number" ? number(source.dir) : String(source.dir || source.facing || "right"),
      scaleX: number(source.scaleX, 100),
      scaleY: number(source.scaleY, 100),
      aimX: number(source.aimX, GAME_WIDTH / 2),
      aimY: number(source.aimY, GAME_HEIGHT / 2),
      rotation: number(source.rotation),
      dead: Boolean(source.dead)
    };
  }


  function normalizeAppearance(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const clean = (value) => {
      if (value == null) return null;
      if (["string", "number", "boolean"].includes(typeof value)) return value;
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
    };
    return {
      character: clean(source.character),
      hat: clean(source.hat),
      armor: clean(source.armor),
      mask: clean(source.mask),
      mouth: clean(source.mouth),
      shirt: clean(source.shirt)
    };
  }


  const PROFILE_NUMERIC_FIELDS = [
    "level", "xp", "cash", "statPoints", "skillPoints",
    "statSTR", "statDEX", "statEND", "statTAC", "statAWR", "statLEAD",
    "skillUnarmed", "skillMelee", "skillShotgun", "skillRifle",
    "skillSMG", "skillRevolver", "skillPistol", "skillHeavy"
  ];
  const STAT_FIELDS = ["statSTR", "statDEX", "statEND", "statTAC", "statAWR", "statLEAD"];
  const SKILL_FIELDS = ["skillUnarmed", "skillMelee", "skillShotgun", "skillRifle", "skillSMG", "skillRevolver", "skillPistol", "skillHeavy"];

  function finiteClamp(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }

  function normalizeProfile(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const appearance = normalizeAppearance(source);
    return {
      tag: String(source.tag || "").slice(0, 48),
      name: sanitizeNick(source.name, "PLAYER"),
      level: Math.floor(finiteClamp(source.level, 1, 999, 1)),
      xp: Math.floor(finiteClamp(source.xp, 0, 2_000_000_000, 0)),
      cash: Math.floor(finiteClamp(source.cash, 0, 2_000_000_000, 0)),
      statPoints: Math.floor(finiteClamp(source.statPoints, 0, 9999, 0)),
      skillPoints: Math.floor(finiteClamp(source.skillPoints, 0, 9999, 0)),
      statSTR: Math.floor(finiteClamp(source.statSTR, 0, 999, 0)),
      statDEX: Math.floor(finiteClamp(source.statDEX, 0, 999, 0)),
      statEND: Math.floor(finiteClamp(source.statEND, 0, 999, 0)),
      statTAC: Math.floor(finiteClamp(source.statTAC, 0, 999, 0)),
      statAWR: Math.floor(finiteClamp(source.statAWR, 0, 999, 0)),
      statLEAD: Math.floor(finiteClamp(source.statLEAD, 0, 999, 0)),
      skillUnarmed: Math.floor(finiteClamp(source.skillUnarmed, 0, 999, 0)),
      skillMelee: Math.floor(finiteClamp(source.skillMelee, 0, 999, 0)),
      skillShotgun: Math.floor(finiteClamp(source.skillShotgun, 0, 999, 0)),
      skillRifle: Math.floor(finiteClamp(source.skillRifle, 0, 999, 0)),
      skillSMG: Math.floor(finiteClamp(source.skillSMG, 0, 999, 0)),
      skillRevolver: Math.floor(finiteClamp(source.skillRevolver, 0, 999, 0)),
      skillPistol: Math.floor(finiteClamp(source.skillPistol, 0, 999, 0)),
      skillHeavy: Math.floor(finiteClamp(source.skillHeavy, 0, 999, 0)),
      ...appearance
    };
  }

  function profileSignature(profile) {
    try { return JSON.stringify(profile); } catch (_) { return ""; }
  }

  function positiveDeltaSum(next, previous, fields) {
    return fields.reduce((sum, field) => sum + Math.max(0, Number(next[field]) - Number(previous[field])), 0);
  }

  function validateGuestProfile(raw) {
    const next = normalizeProfile(raw);
    const previous = state.guestAuthoritativeProfile;
    const now = Date.now();
    if (!previous) {
      state.guestAuthoritativeProfile = next;
      state.guestProfileAcceptedAt = now;
      return { profile: next, corrected: false, reason: "" };
    }

    const corrected = { ...next };
    const elapsedSeconds = Math.max(1, (now - state.guestProfileAcceptedAt) / 1000);
    const reasons = [];

    if (corrected.level < previous.level || corrected.level > previous.level + 1) {
      corrected.level = previous.level;
      reasons.push("LEVEL");
    }
    const maxXpGain = 250000 + Math.floor(elapsedSeconds * 50000);
    if (corrected.xp < 0 || corrected.xp > previous.xp + maxXpGain) {
      corrected.xp = previous.xp;
      reasons.push("XP");
    }
    const maxCashGain = 75000 + Math.floor(elapsedSeconds * 15000);
    if (corrected.cash > previous.cash + maxCashGain) {
      corrected.cash = previous.cash;
      reasons.push("MONEY");
    }

    const statSpend = Math.max(0, previous.statPoints - corrected.statPoints) + Math.max(0, corrected.level - previous.level) * 2;
    if (positiveDeltaSum(corrected, previous, STAT_FIELDS) > statSpend + 1) {
      for (const field of STAT_FIELDS) corrected[field] = previous[field];
      corrected.statPoints = previous.statPoints;
      reasons.push("STATS");
    }
    const skillSpend = Math.max(0, previous.skillPoints - corrected.skillPoints) + Math.max(0, corrected.level - previous.level) * 2;
    if (positiveDeltaSum(corrected, previous, SKILL_FIELDS) > skillSpend + 1) {
      for (const field of SKILL_FIELDS) corrected[field] = previous[field];
      corrected.skillPoints = previous.skillPoints;
      reasons.push("SKILLS");
    }

    state.guestAuthoritativeProfile = normalizeProfile(corrected);
    state.guestProfileAcceptedAt = now;
    if (reasons.length) state.antiCheatWarnings += 1;
    return { profile: state.guestAuthoritativeProfile, corrected: Boolean(reasons.length), reason: reasons.join(", ") };
  }

  function normalizeHire(raw, owner = "") {
    const profile = normalizeProfile(raw);
    return {
      ...profile,
      owner: owner === "guest" ? "guest" : "host",
      netId: String(raw?.netId || "").slice(0, 48)
    };
  }

  function validateHireList(raw, owner) {
    const source = Array.isArray(raw) ? raw : [];
    return source.slice(0, 6).map((entry, index) => ({
      ...normalizeHire(entry, owner),
      netId: `hire-${owner}-${index}`
    }));
  }

  function canonicalHires() {
    const hostHires = state.role === "host" ? state.localHires : state.remoteHires;
    const guestHires = state.role === "host" ? state.remoteHires : state.localHires;
    return [
      ...hostHires.map((hire, index) => ({ ...hire, owner: "host", netId: `hire-host-${index}` })),
      ...guestHires.map((hire, index) => ({ ...hire, owner: "guest", netId: `hire-guest-${index}` }))
    ];
  }

  function sendRosterState() {
    if (state.role !== "host") return false;
    return sendControlPacket({
      type: "roster_state",
      hostRevision: state.localRosterRevision,
      guestRevision: state.remoteRosterRevision,
      hostHires: validateHireList(state.localHires, "host"),
      guestHires: validateHireList(state.remoteHires, "guest")
    });
  }


  const ADMIN_NICK = "Lukamer";
  const ADMIN_PRESETS = [
    ["woody", "Dummy"], ["coward", "Deserter"], ["civ", "Grunt"], ["scientist", "Lab Geek"],
    ["agent", "Agent"], ["agent2", "Agent Mk1"], ["agent3", "Agent Mk0"],
    ["mag", "Mag Agent"], ["fatboy", "Fatboy"], ["fatman", "Fatman"],
    ["hank", "Hank"], ["sanford", "Sanford"], ["deimos", "Deimos"],
    ["jesus", "Jesus"], ["jesus1", "Evil-doer · MAGIC"], ["jesus2", "Dr. Christoff · MAGIC"],
    ["tricky", "Tricky"], ["tricky2", "Dr. Hofnarr"], ["blockhead", "Blockhead"],
    ["swain", "The Swain"], ["krinkels", "Lukamer"], ["cheshyre", "Cheshyre"], ["luis", "Luis"],
    ["arena", "Arena Player"], ["arenatest", "Arena Test"], ["arena_merc", "Mercenary"],
    ["zombie", "Zombie"], ["zombie_agent", "Zombie Agent"], ["zombie_agent2", "Zombie Agent Mk1"],
    ["zombie_yellow", "Yellow Zombie"], ["zombie_agent3", "Zombie Agent Mk0"],
    ["zombie_fatboy", "Zombie G03LM"], ["zombie_riot", "Zombie Riot"],
    ["abom", "Abomination"], ["patient", "Patient"], ["experiment", "Experiment"],
    ["riot", "Riot Agent"], ["mag2", "MAG Agent Mk2"], ["phobos", "Auditor / Phobos · MAGIC"]
  ];
  const ADMIN_MAGIC_PRESETS = new Set(["jesus1", "jesus2", "phobos"]);
  const ADMIN_SPELL_COOLDOWNS = { 1: 900, 2: 1500 };

  function isLukamerAdmin() {
    return state.localNick === ADMIN_NICK;
  }

  function adminMagicEnabled() {
    return isLukamerAdmin() && ADMIN_MAGIC_PRESETS.has(state.adminPresetApplied);
  }

  function queueAdminSpell(level) {
    const spell = Math.floor(Number(level));
    if (!isLukamerAdmin()) return false;
    if (![1, 2].includes(spell)) return false;
    if (!ADMIN_MAGIC_PRESETS.has(state.adminPresetApplied)) {
      showSiteDialog("Nejdřív v ADMIN menu vyber Evil-doer, Dr. Christoff nebo Auditor / Phobos.", "warn", { transient: false });
      return false;
    }
    if (!state.arenaLaunched) {
      showSiteDialog("Spelly lze použít až po spuštění arény.", "warn", { transient: false });
      return false;
    }
    const now = Date.now();
    const cooldown = ADMIN_SPELL_COOLDOWNS[spell] || 1000;
    if (now - state.adminSpellLastCastAt < cooldown) {
      showSiteDialog("SPELL SE JEŠTĚ NABÍJÍ", "warn", { transient: true, duration: 900 });
      return false;
    }
    state.adminSpellLastCastAt = now;
    state.adminSpellQueue = spell;
    state.adminSpellQueueAt = now;
    sendControlPacket({
      type: "admin_spell",
      spell,
      preset: state.adminPresetApplied,
      actorRole: state.role,
      castAt: now
    });
    showSiteDialog(spell === 1 ? "SPELL 1 · EXPLOZE" : "SPELL 2 · ENERGETICKÝ PROJEKTIL", "ok", { transient: true, duration: 900 });
    return true;
  }

  function updateArenaCopyright() {
    const active = Boolean(state.arenaLaunched);
    const element = document.getElementById("arenaCopyright");
    if (element) element.hidden = !active;
    document.documentElement.dataset.arenaActive = active ? "true" : "false";
    window.dispatchEvent(new CustomEvent("madness-arena-state", { detail: { active } }));
  }

  let lastDialogText = "";
  let lastDialogAt = 0;
  let lastStatusText = "";
  let dialogTimer = 0;

  function dialogElements() {
    return {
      root: document.getElementById("siteDialog"),
      title: document.getElementById("siteDialogTitleText"),
      message: document.getElementById("siteDialogMessage"),
      form: document.getElementById("siteDialogForm"),
      actions: document.getElementById("siteDialogActions"),
      close: document.getElementById("siteDialogClose")
    };
  }

  function closeSiteDialog() {
    const { root, form, actions } = dialogElements();
    if (dialogTimer) clearTimeout(dialogTimer);
    dialogTimer = 0;
    if (form) form.replaceChildren();
    if (actions) actions.replaceChildren();
    if (root) {
      root.hidden = true;
      root.dataset.transient = "false";
      root.dataset.kind = "";
    }
  }

  function createDialogButton(label, onClick, variant = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `madness-button ${variant}`.trim();
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  function openGameDialog({ title = "MADNESS: PROJECT NEXUS", message = "", kind = "", transient = false, duration = 1900, build = null, buttons = [], closable = true } = {}) {
    const elements = dialogElements();
    if (!elements.root || !elements.title || !elements.message || !elements.form || !elements.actions || !elements.close) {
      console[kind === "error" ? "error" : "log"](message);
      return;
    }
    if (dialogTimer) clearTimeout(dialogTimer);
    dialogTimer = 0;
    elements.title.textContent = title;
    elements.message.textContent = String(message || "");
    elements.form.replaceChildren();
    elements.actions.replaceChildren();
    elements.root.dataset.kind = kind || "";
    elements.root.dataset.transient = transient ? "true" : "false";
    elements.close.hidden = !closable || transient;
    if (typeof build === "function") build(elements.form);
    for (const spec of buttons) {
      elements.actions.appendChild(createDialogButton(spec.label, spec.onClick, spec.variant || ""));
    }
    elements.root.hidden = false;
    if (transient) dialogTimer = window.setTimeout(closeSiteDialog, duration);
  }

  function showSiteDialog(text, kind = "", options = {}) {
    const messageText = String(text || "").trim();
    if (!messageText) {
      closeSiteDialog();
      return;
    }
    const now = Date.now();
    const transient = Boolean(options.transient);
    if (lastDialogText === messageText && now - lastDialogAt < 1200) return;
    lastDialogText = messageText;
    lastDialogAt = now;
    openGameDialog({
      title: kind === "error" ? "CHYBA" : kind === "warn" ? "UPOZORNĚNÍ" : "ONLINE CO-OP",
      message: messageText,
      kind,
      transient,
      duration: options.duration || 1900,
      closable: !transient,
      buttons: transient ? [] : [{ label: "OK", variant: "primary", onClick: closeSiteDialog }]
    });
  }

  function setStatus(text, kind = "") {
    const value = String(text || "").trim();
    if (!value || value === lastStatusText) return;
    lastStatusText = value;
    showSiteDialog(value, kind, { transient: false });
    updateCoopHud();
  }

  function updateCoopHud() {
    const hud = document.getElementById("coopHud");
    const role = document.getElementById("coopHudRole");
    const room = document.getElementById("coopHudRoom");
    const admin = document.getElementById("adminMenuButton");
    if (hud) hud.hidden = !state.role;
    if (role) role.textContent = state.role === "host" ? "HOST" : state.role === "guest" ? "HRÁČ 2" : "";
    if (room) room.textContent = state.room || "";
    if (admin) admin.hidden = !isLukamerAdmin();
  }

  function openAdminMenu() {
    if (!isLukamerAdmin()) return;
    openGameDialog({
      title: "LUKAMER ADMIN",
      message: "Vyber postavu. Evil-doer, Dr. Christoff a Auditor / Phobos mají admin spelly F6 a F7.",
      kind: "admin",
      build(form) {
        const label = document.createElement("label");
        label.className = "madness-label";
        label.textContent = "POSTAVA";
        const select = document.createElement("select");
        select.id = "adminCharacterSelect";
        select.className = "madness-select";
        for (const [value, name] of ADMIN_PRESETS) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = name;
          if (value === state.adminPresetApplied) option.selected = true;
          select.appendChild(option);
        }
        form.append(label, select);
      },
      buttons: [
        {
          label: "POUŽÍT POSTAVU",
          variant: "danger",
          onClick() {
            const select = document.getElementById("adminCharacterSelect");
            const preset = String(select?.value || "");
            if (!ADMIN_PRESETS.some(([value]) => value === preset)) return;
            state.adminPresetQueue = preset;
            state.adminPresetApplied = preset;
            state.adminSpellQueue = 0;
            state.remoteSpellQueue = 0;
            closeSiteDialog();
            showSiteDialog(`ADMIN · POSTAVA ${select.options[select.selectedIndex]?.textContent || preset} PŘIPRAVENA`, "ok", { transient: true, duration: 1600 });
          }
        },
        { label: "SPELL 1 · EXPLOZE (F6)", variant: "danger", onClick: () => { closeSiteDialog(); queueAdminSpell(1); } },
        { label: "SPELL 2 · PROJEKTIL (F7)", variant: "danger", onClick: () => { closeSiteDialog(); queueAdminSpell(2); } },
        { label: "ZAVŘÍT", onClick: closeSiteDialog }
      ]
    });
  }

  function openJoinDialog(config) {
    openGameDialog({
      title: "PŘIPOJIT SE K MÍSTNOSTI",
      message: "Zadej kód místnosti od hosta.",
      build(form) {
        const input = document.createElement("input");
        input.id = "roomCodeInput";
        input.className = "madness-input";
        input.maxLength = 8;
        input.autocomplete = "off";
        input.spellcheck = false;
        input.placeholder = "KÓD MÍSTNOSTI";
        input.addEventListener("input", () => { input.value = sanitizeRoom(input.value); });
        form.appendChild(input);
        window.setTimeout(() => input.focus(), 0);
      },
      buttons: [
        {
          label: "PŘIPOJIT",
          variant: "primary",
          onClick() {
            const room = sanitizeRoom(document.getElementById("roomCodeInput")?.value);
            if (room.length < 4) {
              showSiteDialog("NEPLATNÝ KÓD MÍSTNOSTI", "error", { transient: false });
              return;
            }
            closeSiteDialog();
            void beginSession("guest", room, config, "HRÁČ 2").catch((error) => setStatus(`CO-OP · ${error.message || "CHYBA"}`, "error"));
          }
        },
        { label: "ZPĚT", onClick: () => openCoopLobbyDialog(config) }
      ]
    });
  }

  function openCoopLobbyDialog(config) {
    openGameDialog({
      title: "ONLINE CO-OP",
      message: "Vytvoř místnost, nebo se připoj ke spoluhráči.",
      buttons: [
        {
          label: "VYTVOŘIT MÍSTNOST",
          variant: "danger",
          onClick() {
            const room = makeRoomCode();
            closeSiteDialog();
            void beginSession("host", room, config, "HOST").catch((error) => setStatus(`CO-OP · ${error.message || "CHYBA"}`, "error"));
          }
        },
        { label: "PŘIPOJIT SE", variant: "primary", onClick: () => openJoinDialog(config) },
        { label: "ZAVŘÍT", onClick: closeSiteDialog }
      ]
    });
  }

  window.madnessShowDialog = showSiteDialog;
  function sanitizeRoom(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
  }

  function makeRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const random = new Uint32Array(6);
    crypto.getRandomValues(random);
    return Array.from(random, (value) => alphabet[value % alphabet.length]).join("");
  }

  function getConfig() {
    const config = window.MADNESS_COOP_CONFIG || {};
    const url = String(config.supabaseUrl || "").trim().replace(/\/$/, "");
    const key = String(config.supabaseAnonKey || "").trim();
    if (!url || !key) {
      showSiteDialog("V config.js chybí Supabase URL nebo veřejný klíč.", "error", { transient: false });
      return null;
    }
    return { url, key };
  }

  function sanitizeNick(value, fallback) {
    const nick = String(value || "")
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18);
    return nick || fallback;
  }

  function dataChannelOpen(channel) {
    return channel?.readyState === "open";
  }

  function realtimeUsable() {
    if (!state.channelReady || !state.channel) return false;
    if (state.channel.state && state.channel.state !== "joined") return false;
    const socket = state.channel.socket;
    if (socket?.isConnected && !socket.isConnected()) return false;
    return true;
  }

  function resetRuntimeState() {
    state.peerPresent = false;
    state.remoteNick = "";
    state.localCharacterReady = false;
    state.remoteCharacterReady = false;
    state.autoMenuPending = false;
    state.autoMenuConsumed = false;
    state.arenaLaunched = false;
    state.arenaLaunchPending = false;
    state.arenaLaunchConsumed = false;
    state.arenaLaunchAck = false;
    state.arenaStartWave = 0;
    state.launchId = "";
    state.remoteInput = blankInput();
    state.remoteInputAt = 0;
    state.localInput = blankInput();
    state.localInputVersion = 0;
    state.lastSentVersion = -1;
    state.lastFallbackInputAt = 0;
    state.snapshotSeq = 0;
    state.remoteSnapshotSeq = -1;
    state.hostPlayers = Object.create(null);
    state.hostNpcs.clear();
    state.remotePlayers = Object.create(null);
    state.remoteNpcs = Object.create(null);
    state.localAppearance = null;
    state.localAppearanceSignature = "";
    state.remoteAppearance = null;
    state.remoteAppearanceVersion = 0;
    state.deliveredAppearanceVersion = 0;
    state.adminPresetQueue = "";
    state.adminPresetApplied = "";
    state.adminSpellQueue = 0;
    state.adminSpellQueueAt = 0;
    state.adminSpellLastCastAt = 0;
    state.remoteSpellQueue = 0;
    state.remoteSpellQueueAt = 0;
    state.remoteSpellPreset = "";
    state.localProfile = null;
    state.localProfileSignature = "";
    state.remoteProfile = null;
    state.remoteProfileVersion = 0;
    state.guestAuthoritativeProfile = null;
    state.guestCorrectionPending = false;
    state.guestProfileAcceptedAt = 0;
    state.antiCheatWarnings = 0;
    state.rosterTemp = [];
    state.localHires = [];
    state.localHireSignature = "";
    state.remoteHires = [];
    state.localRosterRevision = 0;
    state.remoteRosterRevision = 0;
    state.localRosterReady = false;
    state.remoteRosterReady = false;
    updateArenaCopyright();
    updateCoopHud();
    state.controlQueue.clear();
    state.seenControlIds.clear();
  }

  function closePeerConnection() {
    if (state.offerRetryTimer) clearTimeout(state.offerRetryTimer);
    state.offerRetryTimer = 0;
    try { state.controlChannel?.close(); } catch (_) {}
    try { state.stateChannel?.close(); } catch (_) {}
    try { state.pc?.close(); } catch (_) {}
    state.controlChannel = null;
    state.stateChannel = null;
    state.pc = null;
    state.pendingIce = [];
    state.offerId = "";
    state.creatingOffer = false;
    state.connected = false;
  }

  async function leaveSession() {
    state.stopped = true;
    if (state.inputTimer) clearInterval(state.inputTimer);
    if (state.snapshotTimer) clearInterval(state.snapshotTimer);
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    state.inputTimer = 0;
    state.snapshotTimer = 0;
    state.sessionTimer = 0;
    closePeerConnection();
    try {
      if (state.channel && state.supabase) await state.supabase.removeChannel(state.channel);
    } catch (_) {}
    state.role = "";
    state.room = "";
    state.sessionId = "";
    state.channel = null;
    state.channelReady = false;
    state.supabase = null;
    resetRuntimeState();
    updateCoopHud();
  }

  function presenceEntries() {
    try {
      const presence = state.channel?.presenceState?.() || {};
      return Object.values(presence)
        .flatMap((entries) => Array.isArray(entries) ? entries : [])
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }

  function presenceRoles() {
    return presenceEntries().map((entry) => entry?.role).filter(Boolean);
  }

  function syncPeerPresence() {
    const expected = state.role === "host" ? "guest" : "host";
    const peerEntry = presenceEntries().find((entry) => entry?.role === expected);
    const present = Boolean(peerEntry);
    if (peerEntry?.nick) state.remoteNick = sanitizeNick(peerEntry.nick, state.role === "host" ? "HRÁČ 2" : "HOST");
    const changed = present !== state.peerPresent;
    state.peerPresent = present;
    if (present && !state.autoMenuConsumed) state.autoMenuPending = true;

    if (present && state.role === "host") {
      if (changed) setStatus(`CO-OP · HOST · ${state.room} · HRÁČ 2 PŘIPOJEN`, "ok");
      void createOffer();
      sendSessionState(true);
    } else if (present && state.role === "guest") {
      if (changed) setStatus(`CO-OP · HRÁČ 2 · ${state.room} · HOST NALEZEN`, "ok");
      sendControlPacket({ type: "state_request" });
    } else if (!present && changed) {
      state.remoteCharacterReady = false;
      state.connected = false;
      setStatus(`CO-OP · ${state.room} · DRUHÝ HRÁČ SE ODPOJIL`, "warn");
    }
  }

  async function beginSession(role, room, config, nick) {
    await leaveSession();
    state.stopped = false;
    state.role = role;
    state.room = room;
    state.localNick = sanitizeNick(nick, role === "host" ? "HOST" : "HRÁČ 2");
    state.remoteNick = role === "host" ? "HRÁČ 2" : "HOST";
    state.sessionId = randomId(room);
    updateCoopHud();
    state.supabase = window.supabase.createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });

    const channelName = `${ROOM_PREFIX}:${room}`;
    state.channel = state.supabase.channel(channelName, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: state.clientId }
      }
    });

    state.channel
      .on("presence", { event: "sync" }, syncPeerPresence)
      .on("presence", { event: "join" }, syncPeerPresence)
      .on("presence", { event: "leave" }, syncPeerPresence)
      .on("broadcast", { event: "ready" }, ({ payload }) => {
        if (!payload || payload.clientId === state.clientId) return;
        if (state.role === "host" && payload.role === "guest") {
          state.peerPresent = true;
          if (!state.autoMenuConsumed) state.autoMenuPending = true;
          if (payload.nick) state.remoteNick = sanitizeNick(payload.nick, "HRÁČ 2");
          void createOffer();
          sendSessionState(true);
        }
      })
      .on("broadcast", { event: "signal" }, ({ payload }) => void handleSignal(payload))
      .on("broadcast", { event: "arena_start" }, ({ payload }) => {
        if (!payload || payload.clientId === state.clientId || state.role !== "guest") return;
        if (payload.nick) state.remoteNick = sanitizeNick(payload.nick, "HOST");
        state.launchId = String(payload.launchId || state.launchId || "");
        state.arenaStartWave = normalizeStartWave(payload.startWave);
        state.arenaLaunched = true;
        updateArenaCopyright();
        armGuestArenaLaunch();
      })
      .on("broadcast", { event: "packet" }, ({ payload }) => handlePacket(payload, true))
      .on("broadcast", { event: "bye" }, ({ payload }) => {
        if (!payload || payload.clientId === state.clientId) return;
        state.connected = false;
        state.peerPresent = false;
        state.remoteCharacterReady = false;
        setStatus(`CO-OP · ${state.room} · DRUHÝ HRÁČ SE ODPOJIL`, "warn");
      });

    state.channel.subscribe(async (status, error) => {
      if (state.stopped) return;
      state.channelReady = status === "SUBSCRIBED";
      if (status === "SUBSCRIBED") {
        try {
          await state.channel.track({
            role: state.role,
            room: state.room,
            clientId: state.clientId,
            nick: state.localNick,
            at: Date.now()
          });
        } catch (trackError) {
          console.warn("Presence track:", trackError);
        }
        flushControlQueue();
        startInputSender();
        startSessionHeartbeat();
        if (state.role === "host") {
          startSnapshotSender();
          setStatus(`CO-OP · HOST · ${state.room} · ČEKÁM NA HRÁČE 2`, "warn");
          sendSessionState(true);
        } else {
          setStatus(`CO-OP · HRÁČ 2 · ${state.room} · HLEDÁM HOSTA`, "warn");
          await sendBroadcast("ready", { role: "guest", clientId: state.clientId, nick: state.localNick, at: Date.now() });
          sendControlPacket({ type: "state_request" });
        }
        syncPeerPresence();
      } else if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status)) {
        console.error("Supabase Realtime:", status, error || "");
        setStatus("CO-OP · CHYBA PŘIPOJENÍ K SUPABASE", "error");
      }
    });
  }

  async function sendBroadcast(event, payload) {
    if (!realtimeUsable()) return false;
    try {
      const result = await state.channel.send({ type: "broadcast", event, payload });
      return result === "ok" || result === undefined;
    } catch (error) {
      console.error("Supabase broadcast selhal:", error);
      return false;
    }
  }

  function scheduleOfferRetry() {
    if (state.role !== "host" || state.stopped || state.connected || state.offerRetryTimer) return;
    state.offerRetryTimer = window.setTimeout(() => {
      state.offerRetryTimer = 0;
      if (!state.connected && state.peerPresent) void createOffer(true);
    }, OFFER_RETRY_MS);
  }

  function createPeerConnection(force = false) {
    if (!force && state.pc && ["new", "connecting", "connected"].includes(state.pc.connectionState)) {
      return state.pc;
    }
    closePeerConnection();

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
    state.pc = pc;

    pc.onicecandidate = (event) => {
      if (!event.candidate || !state.offerId) return;
      void sendBroadcast("signal", {
        from: state.role,
        clientId: state.clientId,
        offerId: state.offerId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc !== state.pc) return;
      const connection = pc.connectionState;
      if (connection === "connected") {
        state.connected = true;
        state.creatingOffer = false;
        if (state.offerRetryTimer) clearTimeout(state.offerRetryTimer);
        state.offerRetryTimer = 0;
        setStatus(`CO-OP · ${state.role === "host" ? "HOST" : "HRÁČ 2"} · ${state.room} · SYNCHRONIZOVÁNO`, "ok");
        flushControlQueue();
      } else if (["failed", "disconnected", "closed"].includes(connection)) {
        state.connected = false;
        setStatus(`CO-OP · ${state.room} · WEBRTC PŘERUŠENO, POUŽÍVÁM SUPABASE`, "warn");
        scheduleOfferRetry();
      }
    };

    if (state.role === "guest") {
      pc.ondatachannel = (event) => attachDataChannel(event.channel);
    }
    return pc;
  }

  function attachDataChannel(channel) {
    if (!channel) return;
    if (channel.label === "madness-control") state.controlChannel = channel;
    else state.stateChannel = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      state.connected = true;
      state.peerPresent = true;
      setStatus(`CO-OP · ${state.role === "host" ? "HOST" : "HRÁČ 2"} · ${state.room} · PŘÍMÉ SPOJENÍ`, "ok");
      flushControlQueue();
      sendInput(true);
      if (state.role === "host") sendSessionState(true);
      else sendControlPacket({ type: "state_request" });
      if (state.localCharacterReady) sendControlPacket({ type: "character_ready" });
    };

    channel.onclose = () => {
      if (!dataChannelOpen(state.controlChannel) && !dataChannelOpen(state.stateChannel)) {
        state.connected = false;
        scheduleOfferRetry();
      }
    };
    channel.onerror = (error) => console.error(`WebRTC ${channel.label}:`, error);
    channel.onmessage = (event) => {
      try {
        if (typeof event.data !== "string") return;
        const packet = JSON.parse(event.data);
        handlePacket(packet, false);
      } catch (error) {
        console.error("Neplatný síťový paket:", error);
      }
    };
  }

  async function createOffer(force = false) {
    if (state.role !== "host" || state.creatingOffer || state.stopped || !state.peerPresent) return;
    if (!force && (dataChannelOpen(state.controlChannel) || state.pc?.connectionState === "connecting" || state.pc?.connectionState === "connected")) return;
    state.creatingOffer = true;
    try {
      const pc = createPeerConnection(true);
      state.offerId = randomId("offer");
      attachDataChannel(pc.createDataChannel("madness-control", { ordered: true }));
      attachDataChannel(pc.createDataChannel("madness-state", { ordered: false, maxRetransmits: 0 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sent = await sendBroadcast("signal", {
        from: "host",
        clientId: state.clientId,
        offerId: state.offerId,
        description: pc.localDescription?.toJSON?.() || pc.localDescription
      });
      if (!sent) throw new Error("Signalizační kanál není připravený.");
      setStatus(`CO-OP · HOST · ${state.room} · NAVAZUJI PŘÍMÉ SPOJENÍ`, "warn");
      scheduleOfferRetry();
    } catch (error) {
      console.error("WebRTC offer:", error);
      state.creatingOffer = false;
      setStatus(`CO-OP · ${state.room} · WEBRTC SELHALO, POUŽÍVÁM SUPABASE`, "warn");
      scheduleOfferRetry();
    }
  }

  async function flushPendingIce() {
    if (!state.pc?.remoteDescription || !state.pendingIce.length) return;
    const pending = state.pendingIce.splice(0);
    for (const entry of pending) {
      if (entry.offerId && state.offerId && entry.offerId !== state.offerId) continue;
      try { await state.pc.addIceCandidate(entry.candidate); }
      catch (error) { console.warn("ICE candidate:", error); }
    }
  }

  async function handleSignal(payload) {
    if (!payload || payload.clientId === state.clientId || payload.from === state.role || state.stopped) return;
    try {
      if (payload.description?.type === "offer" && state.role === "guest") {
        if (state.offerId === payload.offerId && state.pc?.remoteDescription) return;
        const queuedIce = state.pendingIce.filter((entry) => !entry.offerId || entry.offerId === payload.offerId);
        const pc = createPeerConnection(true);
        state.pendingIce = queuedIce;
        state.offerId = String(payload.offerId || randomId("offer"));
        await pc.setRemoteDescription(payload.description);
        await flushPendingIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendBroadcast("signal", {
          from: "guest",
          clientId: state.clientId,
          offerId: state.offerId,
          description: pc.localDescription?.toJSON?.() || pc.localDescription
        });
        return;
      }

      if (payload.description?.type === "answer" && state.role === "host") {
        if (!state.pc || payload.offerId !== state.offerId) return;
        await state.pc.setRemoteDescription(payload.description);
        state.creatingOffer = false;
        await flushPendingIce();
        return;
      }

      if (payload.candidate) {
        if (payload.offerId && state.offerId && payload.offerId !== state.offerId) return;
        if (state.pc?.remoteDescription) await state.pc.addIceCandidate(payload.candidate);
        else state.pendingIce.push({ offerId: payload.offerId || "", candidate: payload.candidate });
      }
    } catch (error) {
      console.error("WebRTC signal selhal:", error);
      scheduleOfferRetry();
    }
  }

  function controlKey(packet) {
    if (packet.type === "arena_prepare" || packet.type === "arena_ack") return `${packet.type}:${packet.launchId || ""}`;
    return packet.type;
  }

  function decoratePacket(packet, control = false) {
    const value = {
      ...packet,
      from: state.role,
      clientId: state.clientId,
      sessionId: state.sessionId,
      nick: state.localNick,
      at: Date.now()
    };
    if (control && !value.id) value.id = `${state.sessionId}:${++state.controlSeq}`;
    return value;
  }

  function sendThroughChannel(channel, packet) {
    if (!dataChannelOpen(channel)) return false;
    try {
      channel.send(JSON.stringify(packet));
      return true;
    } catch (error) {
      console.error(`WebRTC send ${channel.label}:`, error);
      return false;
    }
  }

  function queueControl(packet) {
    state.controlQueue.set(controlKey(packet), packet);
    while (state.controlQueue.size > CONTROL_QUEUE_LIMIT) {
      state.controlQueue.delete(state.controlQueue.keys().next().value);
    }
  }

  function sendControlPacket(packet) {
    const value = decoratePacket(packet, true);
    const direct = sendThroughChannel(state.controlChannel, value);
    const realtime = realtimeUsable();
    if (realtime) void sendBroadcast("packet", value);
    if (!direct && !realtime) queueControl(value);
    return direct || realtime;
  }

  function flushControlQueue() {
    if (!state.controlQueue.size) return;
    const queued = Array.from(state.controlQueue.values());
    state.controlQueue.clear();
    for (const packet of queued) {
      const direct = sendThroughChannel(state.controlChannel, packet);
      const realtime = realtimeUsable();
      if (realtime) void sendBroadcast("packet", packet);
      if (!direct && !realtime) queueControl(packet);
    }
  }

  function sendFastPacket(packet, allowSupabaseFallback = true) {
    const value = decoratePacket(packet, false);
    if (sendThroughChannel(state.stateChannel, value) || sendThroughChannel(state.controlChannel, value)) return true;
    if (allowSupabaseFallback && realtimeUsable()) {
      void sendBroadcast("packet", value);
      return true;
    }
    return false;
  }

  function rememberControl(packet) {
    if (!packet.id) return false;
    if (state.seenControlIds.has(packet.id)) return true;
    state.seenControlIds.add(packet.id);
    if (state.seenControlIds.size > 256) {
      const first = state.seenControlIds.values().next().value;
      state.seenControlIds.delete(first);
    }
    return false;
  }

  function armGuestArenaLaunch() {
    if (state.role !== "guest" || !state.arenaLaunched || state.arenaLaunchConsumed) return;
    state.arenaLaunchPending = true;
    setStatus(`CO-OP · HRÁČ 2 · ${state.room} · HOST SPOUŠTÍ ARÉNU`, "ok");
  }

  function armHostArenaLaunch() {
    // Host už arénu spustil přímo kliknutím na BEGIN GAME. ACK slouží jen jako potvrzení hostovi.
    if (state.role !== "host" || !state.arenaLaunched || !state.arenaLaunchAck) return;
    state.arenaLaunchPending = false;
  }

  function handlePacket(packet, fromFallback) {
    if (!packet || packet.clientId === state.clientId || packet.from === state.role) return;
    if (packet.sessionId && state.sessionId && packet.sessionId === state.sessionId) return;
    state.peerPresent = true;
    if (packet.nick) state.remoteNick = sanitizeNick(packet.nick, state.role === "host" ? "HRÁČ 2" : "HOST");

    const isControl = !["input", "snapshot"].includes(packet.type);
    if (isControl && rememberControl(packet)) return;

    switch (packet.type) {
      case "state_request":
        if (state.role === "host") sendSessionState(true);
        return;

      case "session_state":
        if (state.role !== "guest") return;
        state.remoteCharacterReady = Boolean(packet.hostCharacterReady);
        state.remoteRosterReady = Boolean(packet.hostRosterReady);
        state.arenaStartWave = normalizeStartWave(packet.arenaStartWave);
        if (packet.arenaLaunched) {
          const incomingLaunch = String(packet.launchId || state.launchId || "");
          if (incomingLaunch && incomingLaunch !== state.lastCompletedLaunchId) {
            state.arenaLaunched = true;
            state.launchId = incomingLaunch;
            armGuestArenaLaunch();
          }
        } else if (!state.arenaLaunchConsumed || state.launchId === state.lastCompletedLaunchId) {
          state.arenaLaunched = false;
          state.arenaLaunchPending = false;
          state.arenaLaunchAck = false;
          state.launchId = "";
        }
        sendControlPacket({
          type: "session_ack",
          launchId: state.launchId,
          arenaConsumed: state.arenaLaunchConsumed,
          characterReady: state.localCharacterReady,
          rosterReady: state.localRosterReady,
          rosterRevision: state.localRosterRevision
        });
        return;

      case "session_ack":
        if (state.role !== "host") return;
        state.remoteCharacterReady = Boolean(packet.characterReady);
        state.remoteRosterReady = Boolean(packet.rosterReady);
        state.remoteRosterRevision = Math.max(state.remoteRosterRevision, Number(packet.rosterRevision) || 0);
        if (packet.arenaConsumed && (!state.launchId || packet.launchId === state.launchId)) {
          state.arenaLaunchAck = true;
          armHostArenaLaunch();
        }
        return;

      case "character_reset":
        state.remoteCharacterReady = false;
        if (!state.arenaLaunchConsumed) {
          state.arenaLaunched = false;
          updateArenaCopyright();
          state.arenaLaunchPending = false;
          state.arenaLaunchAck = false;
          state.launchId = "";
        }
        if (state.role === "host") sendSessionState(true);
        return;

      case "character_ready":
        state.remoteCharacterReady = true;
        if (state.role === "host") {
          setStatus(`CO-OP · HOST · ${state.room} · OBA HRÁČI PŘIPRAVENI`, "ok");
          sendSessionState(true);
        }
        return;

      case "arena_menu_ready":
        if (state.role === "host") {
          state.arenaLaunchAck = false;
          sendSessionState(true);
        }
        return;

      case "arena_prepare":
        if (state.role !== "guest") return;
        if (packet.launchId && packet.launchId === state.lastCompletedLaunchId) return;
        state.launchId = String(packet.launchId || "");
        state.arenaStartWave = normalizeStartWave(packet.startWave);
        state.arenaLaunched = true;
        updateArenaCopyright();
        armGuestArenaLaunch();
        return;

      case "arena_ack":
        if (state.role !== "host" || packet.launchId !== state.launchId) return;
        state.arenaLaunchAck = true;
        armHostArenaLaunch();
        return;

      case "admin_spell": {
        const spell = Math.floor(Number(packet.spell));
        const preset = String(packet.preset || "");
        if (state.remoteNick !== ADMIN_NICK) return;
        if (![1, 2].includes(spell) || !ADMIN_MAGIC_PRESETS.has(preset)) return;
        state.remoteSpellQueue = spell;
        state.remoteSpellQueueAt = Date.now();
        state.remoteSpellPreset = preset;
        return;
      }

      case "profile_update": {
        const incoming = normalizeProfile(packet.profile);
        if (state.role === "host") {
          const result = validateGuestProfile(incoming);
          state.remoteProfile = result.profile;
          state.remoteProfileVersion += 1;
          sendControlPacket({ type: "profile_authority", profile: result.profile, corrected: result.corrected, reason: result.reason });
          if (result.corrected) {
            setStatus(`CO-OP OCHRANA · HRÁČ 2 · ZAMÍTNUTA ZMĚNA: ${result.reason}`, "warn");
          }
        } else {
          state.remoteProfile = incoming;
          state.remoteProfileVersion += 1;
        }
        return;
      }

      case "profile_authority":
        if (state.role !== "guest") return;
        state.guestAuthoritativeProfile = normalizeProfile(packet.profile);
        state.guestCorrectionPending = Boolean(packet.corrected);
        if (packet.corrected) setStatus(`CO-OP OCHRANA · PROFIL OPRAVEN HOSTEM: ${packet.reason || "NEPLATNÁ ZMĚNA"}`, "warn");
        return;

      case "hire_roster": {
        const owner = packet.from === "guest" ? "guest" : "host";
        const hires = validateHireList(packet.hires, owner);
        if (state.role === "host" && owner === "guest") {
          state.remoteHires = hires;
          state.remoteRosterRevision = Math.max(state.remoteRosterRevision, Number(packet.revision) || 0);
          state.remoteRosterReady = true;
          sendRosterState();
          sendSessionState(true);
        } else if (state.role === "guest" && owner === "host") {
          state.remoteHires = hires;
          state.remoteRosterRevision = Math.max(state.remoteRosterRevision, Number(packet.revision) || 0);
          state.remoteRosterReady = true;
        }
        return;
      }

      case "roster_state":
        if (state.role !== "guest") return;
        state.remoteHires = validateHireList(packet.hostHires, "host");
        state.localHires = validateHireList(packet.guestHires, "guest");
        state.remoteRosterRevision = Number(packet.hostRevision) || 0;
        state.localRosterRevision = Number(packet.guestRevision) || state.localRosterRevision;
        state.remoteRosterReady = true;
        state.localRosterReady = true;
        return;

      case "appearance_update":
        state.remoteAppearance = normalizeAppearance(packet.appearance);
        state.remoteAppearanceVersion += 1;
        return;

      case "input":
        state.remoteInput = normalizeInput(packet.input);
        state.remoteInputAt = performance.now();
        return;

      case "snapshot": {
        if (state.role !== "guest") return;
        const seq = Number(packet.seq) || 0;
        if (seq <= state.remoteSnapshotSeq) return;
        state.remoteSnapshotSeq = seq;
        state.remotePlayers = packet.players && typeof packet.players === "object" ? packet.players : Object.create(null);
        state.remoteNpcs = packet.npcs && typeof packet.npcs === "object" ? packet.npcs : Object.create(null);
        if (fromFallback && !state.connected) {
          setStatus(`CO-OP · HRÁČ 2 · ${state.room} · SYNCHRONIZACE PŘES SUPABASE`, "warn");
        }
        return;
      }

      default:
        return;
    }
  }

  function inputKey(code) {
    switch (code) {
      case "KeyW":
      case "ArrowUp": return "up";
      case "KeyS":
      case "ArrowDown": return "down";
      case "KeyA":
      case "ArrowLeft": return "left";
      case "KeyD":
      case "ArrowRight": return "right";
      case "Space": return "fire";
      case "ShiftLeft":
      case "ShiftRight": return "guard";
      case "KeyR": return "reload";
      case "KeyE": return "pickup";
      case "KeyQ": return "slowmo";
      default: return "";
    }
  }

  function updateInput(key, value) {
    if (!state.role || state.localInput[key] === value) return;
    state.localInput[key] = value;
    state.localInputVersion += 1;
    sendInput(true);
  }

  function updateAim(event) {
    if (!state.role) return;
    const stage = document.getElementById("stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width * GAME_WIDTH;
    const y = (event.clientY - rect.top) / rect.height * GAME_HEIGHT;
    if (Math.abs(x - state.localInput.aimX) < 0.5 && Math.abs(y - state.localInput.aimY) < 0.5) return;
    state.localInput.aimX = x;
    state.localInput.aimY = y;
    state.localInputVersion += 1;
  }

  function installInputCapture() {
    if (window.__madnessTrueCoopInputInstalled) return;
    window.__madnessTrueCoopInputInstalled = true;
    window.addEventListener("keydown", (event) => {
      const key = inputKey(event.code);
      if (key) updateInput(key, true);
    });
    window.addEventListener("keyup", (event) => {
      const key = inputKey(event.code);
      if (key) updateInput(key, false);
    });
    window.addEventListener("blur", () => {
      if (!state.role) return;
      const aimX = state.localInput.aimX;
      const aimY = state.localInput.aimY;
      state.localInput = blankInput();
      state.localInput.aimX = aimX;
      state.localInput.aimY = aimY;
      state.localInputVersion += 1;
      sendInput(true);
    });
    window.addEventListener("pointermove", updateAim, { passive: true });
    window.addEventListener("pointerdown", (event) => {
      updateAim(event);
      if (event.button === 0) updateInput("fire", true);
      if (event.button === 2) updateInput("guard", true);
    });
    window.addEventListener("pointerup", (event) => {
      updateAim(event);
      if (event.button === 0) updateInput("fire", false);
      if (event.button === 2) updateInput("guard", false);
    });
    window.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  function sendInput(force = false) {
    if (!state.role) return;
    if (!force && state.lastSentVersion === state.localInputVersion) return;
    const now = performance.now();
    const direct = dataChannelOpen(state.stateChannel) || dataChannelOpen(state.controlChannel);
    if (!direct && !force && now - state.lastFallbackInputAt < FALLBACK_INPUT_MS) return;
    state.lastSentVersion = state.localInputVersion;
    if (!direct) state.lastFallbackInputAt = now;
    sendFastPacket({ type: "input", input: state.localInput }, true);
  }

  function sendSessionState(force = false) {
    if (state.role !== "host") return false;
    if (!force && !state.peerPresent && !state.arenaLaunched) return false;
    return sendControlPacket({
      type: "session_state",
      launchId: state.launchId,
      arenaLaunched: state.arenaLaunched,
      arenaStartWave: state.arenaStartWave,
      hostCharacterReady: state.localCharacterReady,
      guestCharacterReady: state.remoteCharacterReady,
      hostRosterReady: state.localRosterReady,
      guestRosterReady: state.remoteRosterReady,
      hostRosterRevision: state.localRosterRevision,
      guestRosterRevision: state.remoteRosterRevision
    });
  }

  function startSessionHeartbeat() {
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    state.sessionTimer = setInterval(() => {
      if (!state.role) return;
      flushControlQueue();
      if (state.role === "host") {
        sendSessionState(false);
        if (state.localAppearance) sendControlPacket({ type: "appearance_update", appearance: state.localAppearance });
        if (state.localProfile) sendControlPacket({ type: "profile_update", profile: state.localProfile });
        if (state.localRosterReady) sendRosterState();
        if (state.arenaLaunched && !state.arenaLaunchAck) {
          sendControlPacket({
            type: "arena_prepare",
            launchId: state.launchId,
            startWave: state.arenaStartWave
          });
          void sendBroadcast("arena_start", {
            role: "host",
            clientId: state.clientId,
            nick: state.localNick,
            launchId: state.launchId,
            startWave: state.arenaStartWave,
            at: Date.now()
          });
        }
        if (state.peerPresent && !state.connected) void createOffer();
      } else {
        if (!state.peerPresent && realtimeUsable()) {
          void sendBroadcast("ready", { role: "guest", clientId: state.clientId, nick: state.localNick, at: Date.now() });
          sendControlPacket({ type: "state_request" });
        }
        if (state.localCharacterReady) sendControlPacket({ type: "character_ready" });
        if (state.localAppearance) sendControlPacket({ type: "appearance_update", appearance: state.localAppearance });
        if (state.localProfile) sendControlPacket({ type: "profile_update", profile: state.localProfile });
        if (state.localRosterReady) sendControlPacket({ type: "hire_roster", revision: state.localRosterRevision, hires: state.localHires });
        if (state.arenaLaunchConsumed && state.launchId) {
          sendControlPacket({ type: "arena_ack", launchId: state.launchId });
        }
      }
    }, SESSION_HEARTBEAT_MS);
  }

  function startInputSender() {
    if (state.inputTimer) clearInterval(state.inputTimer);
    state.lastSentVersion = -1;
    state.inputTimer = setInterval(() => sendInput(false), INPUT_SEND_MS);
    sendInput(true);
  }

  function startSnapshotSender() {
    if (state.snapshotTimer) clearInterval(state.snapshotTimer);
    state.snapshotTimer = setInterval(() => {
      if (state.role !== "host") return;
      const now = performance.now();
      const npcs = Object.create(null);
      for (const [key, entry] of state.hostNpcs) {
        if (now - entry.seen > NPC_STALE_MS) {
          state.hostNpcs.delete(key);
          continue;
        }
        npcs[key] = entry.state;
      }
      const direct = dataChannelOpen(state.stateChannel) || dataChannelOpen(state.controlChannel);
      if (!direct && now - state.lastFallbackSnapshotAt < FALLBACK_SNAPSHOT_MS) return;
      if (!direct) state.lastFallbackSnapshotAt = now;
      sendFastPacket({
        type: "snapshot",
        seq: ++state.snapshotSeq,
        players: state.hostPlayers,
        npcs
      }, true);
    }, SNAPSHOT_SEND_MS);
  }

  function npcKey(instanceName, rosterName) {
    return `${String(rosterName || "")}|${String(instanceName || "")}`;
  }

  window.madnessCoopSyncCharacter = function madnessCoopSyncCharacter(
    kind, instanceName, rosterName, x, y, health, healthMax,
    facing, aimX, aimY, rotation, dead
  ) {
    if (!state.role) return null;
    const value = normalizeCharacter({ x, y, health, healthMax, facing, aimX, aimY, rotation, dead });

    if (kind === "local" && (
      Math.abs(state.localInput.aimX - value.aimX) > 0.5 ||
      Math.abs(state.localInput.aimY - value.aimY) > 0.5
    )) {
      state.localInput.aimX = value.aimX;
      state.localInput.aimY = value.aimY;
      state.localInputVersion += 1;
    }

    if (state.role === "host") {
      if (kind === "local") state.hostPlayers.host = value;
      else if (kind === "remote") state.hostPlayers.guest = value;
      else state.hostNpcs.set(npcKey(instanceName, rosterName), { state: value, seen: performance.now() });
      return null;
    }

    if (kind === "local") return state.remotePlayers.guest || null;
    if (kind === "remote") return state.remotePlayers.host || null;
    return state.remoteNpcs[npcKey(instanceName, rosterName)] || null;
  };

  window.madnessCoopSyncVisual = function madnessCoopSyncVisual(kind, dir, facing, scaleX, scaleY) {
    if (!state.role) return null;
    const visual = {
      dir: typeof dir === "number" ? Number(dir) : String(dir || facing || "right"),
      facing: typeof facing === "number" ? Number(facing) : String(facing || dir || "right"),
      scaleX: Number.isFinite(Number(scaleX)) ? Number(scaleX) : 100,
      scaleY: Number.isFinite(Number(scaleY)) ? Number(scaleY) : 100
    };
    if (state.role === "host") {
      const slot = kind === "remote" ? "guest" : "host";
      state.hostPlayers[slot] = { ...(state.hostPlayers[slot] || {}), ...visual };
      return null;
    }
    const source = kind === "remote" ? state.remotePlayers.host : state.remotePlayers.guest;
    if (!source) return null;
    return {
      dir: source.dir ?? source.facing ?? "right",
      facing: source.facing ?? source.dir ?? "right",
      scaleX: Number.isFinite(Number(source.scaleX)) ? Number(source.scaleX) : 100,
      scaleY: Number.isFinite(Number(source.scaleY)) ? Number(source.scaleY) : 100
    };
  };

  window.madnessCoopSyncAppearance = function madnessCoopSyncAppearance(kind, character, hat, armor, mask, mouth, shirt) {
    if (!state.role) return null;
    if (kind === "local") {
      const appearance = normalizeAppearance({ character, hat, armor, mask, mouth, shirt });
      let signature = "";
      try { signature = JSON.stringify(appearance); } catch (_) {}
      if (signature && signature !== state.localAppearanceSignature) {
        state.localAppearance = appearance;
        state.localAppearanceSignature = signature;
        sendControlPacket({ type: "appearance_update", appearance });
      }
      return null;
    }
    if (kind !== "remote" || !state.remoteAppearance || state.deliveredAppearanceVersion === state.remoteAppearanceVersion) return null;
    state.deliveredAppearanceVersion = state.remoteAppearanceVersion;
    return state.remoteAppearance;
  };

  window.madnessCoopSyncProfile = function madnessCoopSyncProfile(
    kind, tag, name, level, xp, cash, statPoints, skillPoints,
    statSTR, statDEX, statEND, statTAC, statAWR, statLEAD,
    skillUnarmed, skillMelee, skillShotgun, skillRifle, skillSMG, skillRevolver, skillPistol, skillHeavy,
    character, hat, armor, mask, mouth, shirt
  ) {
    if (!state.role) return null;
    const profile = normalizeProfile({
      tag, name, level, xp, cash, statPoints, skillPoints,
      statSTR, statDEX, statEND, statTAC, statAWR, statLEAD,
      skillUnarmed, skillMelee, skillShotgun, skillRifle, skillSMG, skillRevolver, skillPistol, skillHeavy,
      character, hat, armor, mask, mouth, shirt
    });

    if (kind === "local") {
      const signature = profileSignature(profile);
      if (signature && signature !== state.localProfileSignature) {
        state.localProfile = profile;
        state.localProfileSignature = signature;
        if (state.role === "host") {
          sendControlPacket({ type: "profile_update", profile });
        } else {
          sendControlPacket({ type: "profile_update", profile });
        }
      }
      if (state.role === "guest" && state.guestAuthoritativeProfile && state.guestCorrectionPending) {
        state.guestCorrectionPending = false;
        return state.guestAuthoritativeProfile;
      }
      return null;
    }

    if (kind === "remote") return state.remoteProfile;
    return null;
  };

  window.madnessCoopRosterBegin = function madnessCoopRosterBegin() {
    state.rosterTemp = [];
    return true;
  };

  window.madnessCoopRosterAdd = function madnessCoopRosterAdd(
    tag, name, level, xp, cash, statPoints, skillPoints,
    statSTR, statDEX, statEND, statTAC, statAWR, statLEAD,
    skillUnarmed, skillMelee, skillShotgun, skillRifle, skillSMG, skillRevolver, skillPistol, skillHeavy,
    character, hat, armor, mask, mouth, shirt
  ) {
    if (!state.role || state.rosterTemp.length >= 6) return false;
    state.rosterTemp.push(normalizeHire({
      tag, name, level, xp, cash, statPoints, skillPoints,
      statSTR, statDEX, statEND, statTAC, statAWR, statLEAD,
      skillUnarmed, skillMelee, skillShotgun, skillRifle, skillSMG, skillRevolver, skillPistol, skillHeavy,
      character, hat, armor, mask, mouth, shirt
    }, state.role));
    return true;
  };

  window.madnessCoopRosterCommit = function madnessCoopRosterCommit() {
    if (!state.role) return false;
    const hires = validateHireList(state.rosterTemp, state.role);
    const signature = profileSignature(hires);
    state.rosterTemp = [];
    state.localRosterReady = true;
    if (signature !== state.localHireSignature) {
      state.localHires = hires;
      state.localHireSignature = signature;
      state.localRosterRevision += 1;
    }
    sendControlPacket({ type: "hire_roster", revision: state.localRosterRevision, hires: state.localHires });
    if (state.role === "host") {
      sendRosterState();
      sendSessionState(true);
    }
    return true;
  };

  window.madnessCoopGetSharedHireCount = function madnessCoopGetSharedHireCount() {
    return canonicalHires().length;
  };

  window.madnessCoopGetSharedHire = function madnessCoopGetSharedHire(index) {
    return canonicalHires()[Math.floor(Number(index) || 0)] || null;
  };

  window.madnessAdminGetPreset = function madnessAdminGetPreset() {
    if (!isLukamerAdmin() || !state.adminPresetQueue) return null;
    const preset = state.adminPresetQueue;
    state.adminPresetQueue = "";
    return preset;
  };

  window.madnessAdminGetSpell = function madnessAdminGetSpell(characterName) {
    const name = sanitizeNick(characterName, "");
    const now = Date.now();
    if (name && name === state.localNick && adminMagicEnabled() && state.adminSpellQueue) {
      if (now - state.adminSpellQueueAt > 4000) {
        state.adminSpellQueue = 0;
        return null;
      }
      const spell = state.adminSpellQueue;
      state.adminSpellQueue = 0;
      return spell;
    }
    if (name && name === state.remoteNick && state.remoteNick === ADMIN_NICK && state.remoteSpellQueue) {
      if (now - state.remoteSpellQueueAt > 6000) {
        state.remoteSpellQueue = 0;
        return null;
      }
      const spell = state.remoteSpellQueue;
      state.remoteSpellQueue = 0;
      return spell;
    }
    return null;
  };

  window.madnessCoopGetInput = function madnessCoopGetInput() {
    if (!state.role || performance.now() - state.remoteInputAt > INPUT_TIMEOUT_MS) return blankInput();
    return state.remoteInput;
  };

  window.madnessCoopSetNickname = function madnessCoopSetNickname(value) {
    if (!state.role) return false;
    const fallback = state.role === "host" ? "HOST" : "HRÁČ 2";
    const nickname = sanitizeNick(value, fallback);
    if (!nickname || nickname === state.localNick) return true;

    state.localNick = nickname;
    updateCoopHud();

    if (state.channelReady && state.channel) {
      void state.channel.track({
        role: state.role,
        room: state.room,
        clientId: state.clientId,
        nick: state.localNick,
        at: Date.now()
      }).catch((error) => console.warn("Presence nickname:", error));
    }

    sendControlPacket({ type: "nickname_update" });
    if (state.role === "host") sendSessionState(true);
    else if (realtimeUsable()) {
      void sendBroadcast("ready", {
        role: "guest",
        clientId: state.clientId,
        nick: state.localNick,
        at: Date.now()
      });
    }
    return true;
  };

  window.madnessCoopGetNickname = function madnessCoopGetNickname(kind) {
    const profile = kind === "local" ? state.localProfile : kind === "remote" ? state.remoteProfile : null;
    const nick = kind === "local"
      ? (state.localNick || (state.role === "host" ? "HOST" : "HRÁČ 2"))
      : kind === "remote"
        ? (state.remoteNick || (state.role === "host" ? "HRÁČ 2" : "HOST"))
        : "";
    if (!nick) return "";
    const level = Math.max(1, Math.floor(Number(profile?.level) || 1));
    return `${nick}  ·  LVL ${level}`;
  };

  window.madnessCoopStart = function madnessCoopStart() {
    if (!window.supabase?.createClient) {
      showSiteDialog("Nepodařilo se načíst Supabase knihovnu.", "error", { transient: false });
      return false;
    }

    if (!state.role) {
      const config = getConfig();
      if (!config) return false;
      openCoopLobbyDialog(config);
      return true;
    }

    if (!state.peerPresent) {
      setStatus(`CO-OP · ${state.role === "host" ? "HOST" : "HRÁČ 2"} · ${state.room} · ČEKÁM NA DRUHÉHO HRÁČE`, "warn");
      return true;
    }

    setStatus(`CO-OP · ${state.role === "host" ? "HOST" : "HRÁČ 2"} · ${state.room} · OTEVŘI ARENA A DEJ NEW GAME`, "ok");
    return true;
  };

  window.madnessCoopShouldLaunchMenu = function madnessCoopShouldLaunchMenu() {
    if (!state.role || !state.peerPresent || !state.autoMenuPending || state.autoMenuConsumed) return false;
    state.autoMenuPending = false;
    state.autoMenuConsumed = true;
    setStatus(`CO-OP · ${state.room} · OBA HRÁČI PŘIPOJENI · OTEVÍRÁM ARENA NEW GAME`, "ok");
    return true;
  };

  window.madnessCoopResetCharacterReady = function madnessCoopResetCharacterReady() {
    if (!state.role) return false;
    state.localCharacterReady = false;
    state.arenaLaunched = false;
    state.arenaLaunchPending = false;
    state.arenaLaunchConsumed = false;
    state.arenaLaunchAck = false;
    state.arenaStartWave = 0;
    state.launchId = "";
    state.localProfile = null;
    state.localProfileSignature = "";
    state.guestAuthoritativeProfile = null;
    state.guestCorrectionPending = false;
    state.localHires = [];
    state.localHireSignature = "";
    state.localRosterRevision += 1;
    state.localRosterReady = false;
    updateArenaCopyright();
    sendControlPacket({ type: "character_reset" });
    if (state.role === "host") sendSessionState(true);
    setStatus(`CO-OP · ${state.role === "host" ? "HOST" : "HRÁČ 2"} · ${state.room} · VYTVOŘ SI POSTAVU`, "ok");
    return true;
  };

  window.madnessCoopCharacterReady = function madnessCoopCharacterReady() {
    if (!state.role) return false;
    if (!state.localCharacterReady) {
      state.localCharacterReady = true;
      sendControlPacket({ type: "character_ready" });
      if (state.localProfile) sendControlPacket({ type: "profile_update", profile: state.localProfile });
      if (state.localRosterReady) sendControlPacket({ type: "hire_roster", revision: state.localRosterRevision, hires: state.localHires });
      if (state.role === "host") { sendRosterState(); sendSessionState(true); }
    }
    if (state.role === "host") {
      setStatus(
        state.remoteCharacterReady
          ? `CO-OP · HOST · ${state.room} · OBA HRÁČI PŘIPRAVENI · KLIKNI BEGIN GAME`
          : `CO-OP · HOST · ${state.room} · POSTAVA HOTOVÁ · ČEKÁM NA HRÁČE 2`,
        state.remoteCharacterReady ? "ok" : "warn"
      );
    } else {
      armGuestArenaLaunch();
      setStatus(
        state.arenaLaunchPending
          ? `CO-OP · HRÁČ 2 · ${state.room} · SPOUŠTÍM SPOLEČNOU ARÉNU`
          : `CO-OP · HRÁČ 2 · ${state.room} · POSTAVA HOTOVÁ · ČEKÁM, AŽ HOST KLIKNE BEGIN GAME`,
        "ok"
      );
    }
    return true;
  };

  window.madnessCoopArenaMenuReady = function madnessCoopArenaMenuReady() {
    if (!state.role) return false;
    if (state.launchId) state.lastCompletedLaunchId = state.launchId;
    state.arenaLaunched = false;
    state.arenaLaunchPending = false;
    state.arenaLaunchConsumed = false;
    state.arenaLaunchAck = false;
    state.arenaStartWave = 0;
    state.launchId = "";
    state.remoteRosterReady = false;
    state.arenaMenuRevision += 1;
    if (state.localProfile) sendControlPacket({ type: "profile_update", profile: state.localProfile });
    if (state.localRosterReady) sendControlPacket({ type: "hire_roster", revision: state.localRosterRevision, hires: state.localHires });
    sendControlPacket({ type: "arena_menu_ready", revision: state.arenaMenuRevision });
    if (state.role === "host") {
      sendRosterState();
      sendSessionState(true);
      setStatus(`CO-OP · HOST · ${state.room} · UPRAV TÝM A POTOM KLIKNI BEGIN GAME`, "ok");
    } else {
      setStatus(`CO-OP · HRÁČ 2 · ${state.room} · ČEKÁM, AŽ HOST KLIKNE BEGIN GAME`, "ok");
    }
    return true;
  };

  window.madnessCoopCanBeginGame = function madnessCoopCanBeginGame() {
    if (!state.role) return true;
    return state.role === "host"
      && state.peerPresent
      && state.localCharacterReady
      && state.remoteCharacterReady
      && state.localRosterReady
      && state.remoteRosterReady
      && !state.arenaLaunched;
  };

  window.madnessCoopRequestArenaStart = function madnessCoopRequestArenaStart(inStartWave) {
    if (!state.role) return true;
    if (state.role !== "host") {
      setStatus(`CO-OP · HRÁČ 2 · ${state.room} · BEGIN GAME MŮŽE STISKNOUT JEN HOST`, "warn");
      return false;
    }
    if (!state.peerPresent) {
      setStatus(`CO-OP · HOST · ${state.room} · HRÁČ 2 NENÍ PŘIPOJENÝ`, "warn");
      return false;
    }
    if (!state.localCharacterReady || !state.remoteCharacterReady) {
      setStatus(`CO-OP · HOST · ${state.room} · NEJDŘÍV MUSÍ OBA DOKONČIT POSTAVU`, "warn");
      return false;
    }
    if (!state.localRosterReady || !state.remoteRosterReady) {
      setStatus(`CO-OP · HOST · ${state.room} · ČEKÁM NA SYNCHRONIZACI TÝMŮ`, "warn");
      return false;
    }
    if (state.arenaLaunched) {
      setStatus(`CO-OP · HOST · ${state.room} · ČEKÁM NA SPUŠTĚNÍ HRÁČE 2`, "warn");
      return false;
    }

    state.arenaStartWave = normalizeStartWave(inStartWave);
    state.arenaLaunched = true;
    updateArenaCopyright();
    state.arenaLaunchAck = false;
    state.arenaLaunchPending = false;
    // Host spustí původní pickArena okamžitě. Druhý klient se spustí z opakovaného arena_prepare/session_state.
    state.arenaLaunchConsumed = true;
    state.launchId = randomId("launch");
    sendControlPacket({
      type: "arena_prepare",
      launchId: state.launchId,
      startWave: state.arenaStartWave
    });
    void sendBroadcast("arena_start", {
      role: "host",
      clientId: state.clientId,
      nick: state.localNick,
      launchId: state.launchId,
      startWave: state.arenaStartWave,
      at: Date.now()
    });
    sendSessionState(true);
    setStatus(`CO-OP · HOST · ${state.room} · SPOUŠTÍM SPOLEČNOU ARÉNU`, "ok");
    return true;
  };

  window.madnessCoopShouldLaunchArena = function madnessCoopShouldLaunchArena() {
    if (state.arenaLaunchConsumed) return false;
    if (state.role === "guest") {
      if (!state.arenaLaunched || !state.localCharacterReady || !state.launchId) return false;
      state.arenaLaunchPending = true;
      state.arenaLaunchPending = false;
      state.arenaLaunchConsumed = true;
      sendControlPacket({ type: "arena_ack", launchId: state.launchId });
      setStatus(`CO-OP · HRÁČ 2 · ${state.room} · SPOUŠTÍM SPOLEČNOU ARÉNU`, "ok");
      return true;
    }
    if (state.role === "host" && state.arenaLaunchAck) {
      state.arenaLaunchPending = false;
      state.arenaLaunchConsumed = true;
      setStatus(`CO-OP · HOST · ${state.room} · SPOUŠTÍM SPOLEČNOU ARÉNU`, "ok");
      return true;
    }
    return false;
  };

  window.madnessCoopGetArenaStartWave = () => state.arenaStartWave;
  window.madnessCoopRole = () => state.role;

  window.addEventListener("beforeunload", () => {
    if (state.channel) void sendBroadcast("bye", { role: state.role, clientId: state.clientId, at: Date.now() });
  });

  window.addEventListener("DOMContentLoaded", () => {
    const { close } = dialogElements();
    close?.addEventListener("click", closeSiteDialog);
    document.getElementById("adminMenuButton")?.addEventListener("click", openAdminMenu);
    document.getElementById("coopHudCopy")?.addEventListener("click", async () => {
      if (!state.room) return;
      try {
        await navigator.clipboard.writeText(state.room);
        showSiteDialog(`KÓD ${state.room} ZKOPÍROVÁN`, "ok", { transient: true, duration: 1300 });
      } catch (_) {
        showSiteDialog(`KÓD MÍSTNOSTI: ${state.room}`, "ok", { transient: false });
      }
    });
    window.addEventListener("keydown", (event) => {
      const root = document.getElementById("siteDialog");
      if (event.key === "Escape" && root && !root.hidden && root.dataset.transient !== "true") closeSiteDialog();
      if (event.code === "F2" && isLukamerAdmin()) {
        event.preventDefault();
        openAdminMenu();
      }
      if (!event.repeat && event.code === "F6" && isLukamerAdmin()) {
        event.preventDefault();
        queueAdminSpell(1);
      }
      if (!event.repeat && event.code === "F7" && isLukamerAdmin()) {
        event.preventDefault();
        queueAdminSpell(2);
      }
    });
    updateCoopHud();
  });

  // Small diagnostic surface for local testing; it contains no secret data.
  window.__madnessCoopDebug = {
    state,
    handlePacket,
    normalizeProfile,
    validateGuestProfile,
    canonicalHires,
    close: leaveSession
  };

  installInputCapture();
})();
