// Spanish flashcard app — mobile-first, localStorage-backed SRS (SM-2 lite).
(() => {
  const $ = (id) => document.getElementById(id);
  const RAW = window.DATA || [];
  const CHAPTERS = window.DATA_CHAPTERS || [];
  const CHAPTER_LABELS = {
    essentials:"Essentials", transport:"Transport", home:"In the Home",
    shops:"At the Shops", "day-to-day":"Day-to-Day", leisure:"Leisure",
    sport:"Sport", health:"Health", earth:"Planet Earth", celebrations:"Celebrations"
  };
  const CHAPTER_ORDER = ["essentials","day-to-day","home","shops","transport","leisure","sport","health","earth","celebrations"];
  const ALL = RAW.map((d,i) => ({...d, id:"c"+i, kind:d.k}));
  const BY_ID = Object.fromEntries(ALL.map(c => [c.id, c]));
  const WORDS = ALL.filter(c => c.kind === "word");
  const SENTS = ALL.filter(c => c.kind === "sentence");

  // Render deck buttons
  const grid = $("deckGrid");
  const addDeck = (key, title, sub) => {
    const b = document.createElement("button");
    b.className = "deck"; b.dataset.deck = key;
    b.innerHTML = `<div class="deck-title">${title}</div><div class="deck-sub">${sub}</div>`;
    grid.appendChild(b);
  };
  addDeck("all", "All", `${ALL.length} cards`);
  addDeck("words", "Words only", `${WORDS.length} cards`);
  addDeck("sentences", "Phrases only", `${SENTS.length} cards`);
  for (const k of CHAPTER_ORDER) {
    if (!CHAPTERS.includes(k)) continue;
    const n = ALL.filter(c => c.ch === k).length;
    addDeck("ch:" + k, CHAPTER_LABELS[k] || k, `${n} cards`);
  }

  // ---------- persistence ----------
  const STATE_KEY = "es-flashcards-v1";
  const PREFS_KEY = "es-flashcards-prefs-v1";
  const todayStr = () => new Date().toISOString().slice(0,10);

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; } catch { return {}; }
  }
  function saveState(s) { localStorage.setItem(STATE_KEY, JSON.stringify(s)); }
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
  }
  function savePrefs(p) { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); }

  let state = loadState();
  let prefs = loadPrefs();
  if (prefs.englishFirst === undefined) prefs.englishFirst = false;
  if (prefs.autoSpeak === undefined) prefs.autoSpeak = true;
  if (prefs.newPerDay === undefined) prefs.newPerDay = 15;
  if (prefs.reviewMax === undefined) prefs.reviewMax = 120;
  if (!state.cards) state.cards = {};       // id -> {due, interval, ease, reps, lapses}
  if (!state.daily) state.daily = {};       // date -> {newDone, reviews}
  if (!state.streak) state.streak = {last:null, count:0};
  if (!state.deckOrder) state.deckOrder = {}; // deck -> shuffled id list
  saveState(state); savePrefs(prefs);

  $("newPerDay").value = prefs.newPerDay;
  $("reviewMax").value = prefs.reviewMax;
  $("newPerDay").addEventListener("change", e => { prefs.newPerDay = +e.target.value||0; savePrefs(prefs); refreshStats(); });
  $("reviewMax").addEventListener("change", e => { prefs.reviewMax = +e.target.value||0; savePrefs(prefs); refreshStats(); });

  // ---------- deck filtering ----------
  function deckCards(deck) {
    if (deck === "all") return ALL;
    if (deck === "words") return WORDS;
    if (deck === "sentences") return SENTS;
    if (deck && deck.startsWith("ch:")) {
      const k = deck.slice(3);
      return ALL.filter(c => c.ch === k);
    }
    return ALL;
  }
  function getOrder(deck) {
    if (state.deckOrder[deck]) {
      const set = new Set(deckCards(deck).map(c=>c.id));
      const filtered = state.deckOrder[deck].filter(id => set.has(id));
      const existing = new Set(filtered);
      const missing = deckCards(deck).filter(c=>!existing.has(c.id)).map(c=>c.id);
      const order = [...filtered, ...shuffle(missing)];
      state.deckOrder[deck] = order;
      saveState(state);
      return order;
    }
    const order = shuffle(deckCards(deck).map(c=>c.id));
    state.deckOrder[deck] = order;
    saveState(state);
    return order;
  }
  function shuffle(a) { a=[...a]; for (let i=a.length-1;i>0;i--){const j=(Math.random()*(i+1))|0;[a[i],a[j]]=[a[j],a[i]];} return a; }

  // ---------- SRS ----------
  // Grades: 0 Again, 1 Hard, 2 Good, 3 Easy
  function cardState(id) {
    return state.cards[id] || {due:null, interval:0, ease:2.5, reps:0, lapses:0, learning:true};
  }
  function isDue(cs) {
    return cs.due && cs.due <= Date.now();
  }
  function isNew(cs) { return cs.reps === 0 && !cs.due; }
  function schedule(id, grade) {
    const cs = cardState(id);
    const now = Date.now();
    const MIN = 60*1000;
    if (cs.learning || cs.reps === 0) {
      if (grade === 0) { cs.due = now + 1*MIN; cs.learning = true; cs.lapses++; }
      else if (grade === 1) { cs.due = now + 6*MIN; cs.learning = true; }
      else if (grade === 2) {
        cs.reps++;
        cs.interval = cs.reps === 1 ? 1 : 3;
        cs.due = now + cs.interval*86400000;
        cs.learning = false;
      } else {
        cs.reps++;
        cs.interval = 4;
        cs.due = now + cs.interval*86400000;
        cs.learning = false;
      }
    } else {
      if (grade === 0) {
        cs.lapses++;
        cs.reps = 0;
        cs.interval = 0;
        cs.ease = Math.max(1.3, cs.ease - 0.2);
        cs.due = now + 10*MIN;
        cs.learning = true;
      } else {
        const mult = grade === 1 ? 1.2 : grade === 2 ? cs.ease : cs.ease * 1.3;
        cs.ease = Math.max(1.3, cs.ease + (grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0));
        cs.interval = Math.max(1, Math.round((cs.interval || 1) * mult));
        cs.reps++;
        cs.due = now + cs.interval*86400000;
      }
    }
    state.cards[id] = cs;
    bumpDaily(grade);
    saveState(state);
  }
  function bumpDaily(grade) {
    const d = todayStr();
    if (!state.daily[d]) state.daily[d] = {newDone:0, reviews:0};
    state.daily[d].reviews++;
    // streak
    if (state.streak.last !== d) {
      const y = new Date(); y.setDate(y.getDate()-1);
      const yStr = y.toISOString().slice(0,10);
      state.streak.count = state.streak.last === yStr ? state.streak.count+1 : 1;
      state.streak.last = d;
    }
  }

  function pickNextForDeck(deck) {
    const order = getOrder(deck);
    const d = todayStr();
    const day = state.daily[d] || {newDone:0};
    // 1) due reviews
    for (const id of order) {
      const cs = cardState(id);
      if (cs.due && cs.due <= Date.now() && !isNew(cs)) return id;
    }
    // 2) learning cards (short-term due)
    for (const id of order) {
      const cs = cardState(id);
      if (cs.learning && cs.due && cs.due <= Date.now()) return id;
    }
    // 3) new cards up to daily limit
    if (day.newDone < prefs.newPerDay) {
      for (const id of order) {
        const cs = cardState(id);
        if (isNew(cs)) {
          day.newDone = (day.newDone||0)+1;
          state.daily[d] = day;
          saveState(state);
          return id;
        }
      }
    }
    // 4) soonest upcoming learning card if nothing else
    let soonest = null, soonestT = Infinity;
    for (const id of order) {
      const cs = cardState(id);
      if (cs.learning && cs.due && cs.due < soonestT) { soonest = id; soonestT = cs.due; }
    }
    if (soonest && soonestT - Date.now() < 60*1000) return soonest;
    return null;
  }

  // ---------- stats ----------
  function refreshStats(deck = currentDeck || "all") {
    const cards = deckCards(deck);
    let dueCount = 0, newCount = 0;
    for (const c of cards) {
      const cs = cardState(c.id);
      if (isNew(cs)) newCount++;
      else if (cs.due && cs.due <= Date.now()) dueCount++;
    }
    const d = todayStr();
    const day = state.daily[d] || {newDone:0};
    const newAvail = Math.max(0, prefs.newPerDay - (day.newDone||0));
    $("statDue").textContent = dueCount + " due";
    $("statNew").textContent = Math.min(newCount, newAvail) + " new";
    $("statStreak").textContent = "🔥" + (state.streak.count || 0);
  }

  // ---------- UI ----------
  let currentDeck = null;
  let currentCardId = null;
  let showingBack = false;
  let sessionCount = 0;
  let sessionTarget = 20;

  const deckPicker = $("deckPicker");
  const studyScreen = $("study");
  const doneScreen = $("done");

  grid.addEventListener("click", e => {
    const b = e.target.closest(".deck");
    if (b) startDeck(b.dataset.deck);
  });
  $("backHome").addEventListener("click", showHome);
  $("doneBack").addEventListener("click", showHome);

  function showHome() {
    deckPicker.classList.remove("hidden");
    studyScreen.classList.add("hidden");
    doneScreen.classList.add("hidden");
    currentDeck = null;
    refreshStats("all");
  }

  function startDeck(deck) {
    currentDeck = deck;
    sessionCount = 0;
    deckPicker.classList.add("hidden");
    doneScreen.classList.add("hidden");
    studyScreen.classList.remove("hidden");
    refreshStats(deck);
    const dueCount = +$("statDue").textContent.split(" ")[0];
    const newCount = +$("statNew").textContent.split(" ")[0];
    sessionTarget = Math.max(1, Math.min(prefs.reviewMax, dueCount + newCount));
    nextCard();
  }

  function nextCard() {
    const id = pickNextForDeck(currentDeck);
    if (!id) { showDone(); return; }
    currentCardId = id;
    showingBack = false;
    renderCard(BY_ID[id]);
    refreshStats(currentDeck);
    $("progressBar").style.width = Math.min(100, (sessionCount/sessionTarget)*100) + "%";
  }

  function renderCard(card) {
    const card$ = $("card");
    card$.classList.toggle("sentence", card.kind === "sentence");
    const tag = (CHAPTER_LABELS[card.ch] || card.kind || "word").toLowerCase();
    $("cardTag").textContent = tag;
    $("cardTagBack").textContent = tag;
    const frontText = prefs.englishFirst ? card.en : card.es;
    const backText = prefs.englishFirst ? card.es : card.en;
    $("cardFront").textContent = frontText;
    $("cardFrontBack").textContent = frontText;
    $("cardBack").textContent = backText;
    $("cardHint").textContent = "";
    $("cardExample").textContent = card.ex || "";
    $("card").querySelector(".front").classList.remove("hidden");
    $("card").querySelector(".back").classList.add("hidden");
    $("rateBar").classList.add("hidden");
    $("revealBar").classList.remove("hidden");
    updateRateLabels();
    if (prefs.autoSpeak && !prefs.englishFirst) speak(card.es);
  }

  function flip() {
    if (showingBack) return;
    showingBack = true;
    $("card").querySelector(".front").classList.add("hidden");
    $("card").querySelector(".back").classList.remove("hidden");
    $("rateBar").classList.remove("hidden");
    $("revealBar").classList.add("hidden");
    const card = BY_ID[currentCardId];
    if (prefs.autoSpeak && prefs.englishFirst) speak(card.es);
  }

  $("card").addEventListener("click", flip);
  $("revealBtn").addEventListener("click", flip);
  $("skipBtn").addEventListener("click", () => nextCard());
  $("speakBtn").addEventListener("click", () => { const c = BY_ID[currentCardId]; if (c) speak(c.es); });
  $("flipDirBtn").addEventListener("click", () => {
    prefs.englishFirst = !prefs.englishFirst; savePrefs(prefs);
    $("toggleDir").checked = prefs.englishFirst;
    renderCard(BY_ID[currentCardId]);
  });

  document.querySelectorAll(".rate").forEach(btn => {
    btn.addEventListener("click", () => {
      const g = +btn.dataset.grade;
      schedule(currentCardId, g);
      sessionCount++;
      nextCard();
    });
  });

  // keyboard
  document.addEventListener("keydown", e => {
    if (studyScreen.classList.contains("hidden")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!showingBack) flip(); }
    else if (showingBack && ["1","2","3","4"].includes(e.key)) {
      const g = +e.key - 1;
      schedule(currentCardId, g);
      sessionCount++;
      nextCard();
    }
  });

  function updateRateLabels() {
    const cs = cardState(currentCardId);
    function fmt(ms){ if(ms<60000)return "<1m"; if(ms<3600000)return Math.round(ms/60000)+"m"; if(ms<86400000)return Math.round(ms/3600000)+"h"; return Math.round(ms/86400000)+"d"; }
    const again = 60000;
    const hard = 6*60000;
    let good, easy;
    if (cs.reps === 0 || cs.learning) { good = 1*86400000; easy = 4*86400000; }
    else {
      good = Math.max(1, Math.round((cs.interval||1) * cs.ease)) * 86400000;
      easy = Math.max(1, Math.round((cs.interval||1) * cs.ease * 1.3)) * 86400000;
    }
    $("lblAgain").textContent = fmt(again);
    $("lblHard").textContent = fmt(hard);
    $("lblGood").textContent = fmt(good);
    $("lblEasy").textContent = fmt(easy);
  }

  function showDone() {
    studyScreen.classList.add("hidden");
    doneScreen.classList.remove("hidden");
    const cards = deckCards(currentDeck || "all");
    const remainingDue = cards.reduce((n,c)=>{const cs=cardState(c.id); return n + (cs.due && cs.due<=Date.now() && !isNew(cs) ? 1 : 0);}, 0);
    const msg = remainingDue ? `Take a breather — ${remainingDue} more due soon.` : "No cards due right now. Come back later.";
    $("doneMsg").textContent = msg;
  }

  // ---------- speech ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return null;
    const voices = speechSynthesis.getVoices();
    voice = voices.find(v => /^es/i.test(v.lang)) || voices.find(v => /spanish/i.test(v.name)) || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!("speechSynthesis" in window) || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(stripMarkers(text));
      u.lang = "es-ES";
      if (voice) u.voice = voice;
      u.rate = 0.95;
      speechSynthesis.speak(u);
    } catch {}
  }
  function stripMarkers(s){ return s.replace(/\s*\/\s*/g, " o ").replace(/\s+/g," "); }

  // ---------- menu ----------
  const dlg = $("menuDlg");
  $("menuBtn").addEventListener("click", () => {
    $("toggleDir").checked = prefs.englishFirst;
    $("toggleAuto").checked = prefs.autoSpeak;
    dlg.showModal();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  $("toggleDir").addEventListener("change", e => { prefs.englishFirst = e.target.checked; savePrefs(prefs); if (currentCardId) renderCard(BY_ID[currentCardId]); });
  $("toggleAuto").addEventListener("change", e => { prefs.autoSpeak = e.target.checked; savePrefs(prefs); });
  document.querySelectorAll(".menu-item[data-action]").forEach(b => {
    b.addEventListener("click", () => {
      const a = b.dataset.action;
      if (a === "reset-deck") {
        if (confirm("Reset progress for current deck?")) {
          const deck = currentDeck || "all";
          for (const c of deckCards(deck)) delete state.cards[c.id];
          delete state.deckOrder[deck];
          saveState(state);
          refreshStats(deck);
          if (!studyScreen.classList.contains("hidden")) nextCard();
        }
      } else if (a === "reset-all") {
        if (confirm("Delete ALL progress on this device?")) {
          localStorage.removeItem(STATE_KEY);
          state = {cards:{}, daily:{}, streak:{last:null,count:0}, deckOrder:{}};
          saveState(state);
          refreshStats();
          showHome();
        }
      } else if (a === "export") {
        const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "spanish-flashcards-progress.json"; a.click();
        setTimeout(()=>URL.revokeObjectURL(url), 1000);
      } else if (a === "import") {
        const input = document.createElement("input");
        input.type = "file"; input.accept = "application/json";
        input.onchange = () => {
          const f = input.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try { state = JSON.parse(r.result); saveState(state); refreshStats(); alert("Imported."); }
            catch { alert("Invalid file."); }
          };
          r.readAsText(f);
        };
        input.click();
      }
      dlg.close();
    });
  });
  dlg.querySelector(".close").addEventListener("click", () => dlg.close());

  // init
  refreshStats("all");
})();
