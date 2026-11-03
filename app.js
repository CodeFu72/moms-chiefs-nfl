const CHIEFS_ID = "12";
const CHIEFS_LOGO_FALLBACK = "https://a.espncdn.com/i/teamlogos/nfl/500/kc.png";

const API = {
  chiefsSchedule: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/12/schedule",
  standings: "https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3",
  scoreboardCurrent: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  scoreboardWeek: (week, seasonType = 2) =>
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=${seasonType}`
};

const state = {
  activeTab: "chiefs",
  standingsFilter: "divisions", // "divisions" | "overall" | "afc" | "nfc"
  currentNflWeek: 1,
  selectedWeek: 1,
  seasonYear: new Date().getFullYear(),
  seasonType: 2,
  chiefsData: null,
  standingsData: null,
  weekScoreboardCache: {},
  lastUpdated: null,
  extraLargeText: localStorage.getItem("moms_chiefs_xl_text") === "1"
};

function initApp() {
  // Apply saved text size preference
  if (state.extraLargeText) {
    document.documentElement.classList.add("extra-large");
  }
  updateTextSizeButton();
  renderTodayBanner();

  // Hide the "Install on Home Screen" helper button if already running as standalone Home Screen app
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  const installBtn = document.getElementById("install-help-btn");
  if (installBtn && isStandalone) {
    installBtn.style.display = "none";
  }

  // Load cached state from localStorage for instant paint
  try {
    const cached = JSON.parse(localStorage.getItem("moms_chiefs_cache_v1") || "null");
    if (cached) {
      state.chiefsData = cached.chiefsData || null;
      state.standingsData = cached.standingsData || null;
      state.currentNflWeek = cached.currentNflWeek || 1;
      state.selectedWeek = state.currentNflWeek;
      if (cached.currentWeekScoreboard) {
        state.weekScoreboardCache[state.currentNflWeek] = cached.currentWeekScoreboard;
      }
      renderAll();
    }
  } catch (_) {}

  // Fetch fresh live NFL data
  refreshAllData(true);

  // Auto-refresh every 60 seconds
  setInterval(() => {
    renderTodayBanner();
    refreshAllData(false);
  }, 60 * 1000);

  // When Mom opens or switches back to the app, refresh and return to My Chiefs if away > 3 mins
  let lastHiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      lastHiddenAt = Date.now();
    } else {
      renderTodayBanner();
      if (lastHiddenAt && Date.now() - lastHiddenAt > 3 * 60 * 1000) {
        switchTab("chiefs");
        state.selectedWeek = state.currentNflWeek;
      }
      refreshAllData(false);
    }
  });

  // Gentle idle reset after 5 minutes of no taps so she never stays stuck on another screen
  let idleTimer = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (state.activeTab !== "chiefs" || state.selectedWeek !== state.currentNflWeek) {
        state.selectedWeek = state.currentNflWeek;
        switchTab("chiefs");
      }
    }, 5 * 60 * 1000);
  };
  ["touchstart", "click", "scroll"].forEach((evt) =>
    window.addEventListener(evt, resetIdle, { passive: true })
  );
  resetIdle();

  // Register Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function renderTodayBanner() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const el = document.getElementById("today-date-text");
  if (el) {
    el.textContent = `Today is ${dateStr}`;
  }
}

function toggleTextSize() {
  state.extraLargeText = !state.extraLargeText;
  document.documentElement.classList.toggle("extra-large", state.extraLargeText);
  localStorage.setItem("moms_chiefs_xl_text", state.extraLargeText ? "1" : "0");
  updateTextSizeButton();
}

function updateTextSizeButton() {
  const btn = document.getElementById("text-size-btn");
  if (!btn) return;
  btn.classList.toggle("active-toggle", state.extraLargeText);
  btn.textContent = state.extraLargeText ? "Text: Extra Large ✓" : "Bigger Text (A+)";
}

function openInstallModal() {
  const m = document.getElementById("install-modal");
  if (m) m.classList.add("open");
}

function closeInstallModal() {
  const m = document.getElementById("install-modal");
  if (m) m.classList.remove("open");
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabName}`);
  });
  document.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (tabName === "schedule") {
    ensureWeekLoaded(state.selectedWeek);
  }
}

function setStandingsFilter(filter) {
  state.standingsFilter = filter;
  document.querySelectorAll("#standings-filter-bar .filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === filter);
  });
  renderStandingsSection();
}

async function refreshAllData(resetWeekToCurrent = false) {
  const statusEl = document.getElementById("update-status-text");
  if (statusEl) statusEl.textContent = "Updating live NFL scores…";

  try {
    const [chiefsRes, standingsRes, sbRes] = await Promise.all([
      fetch(API.chiefsSchedule, { cache: "no-store" }).then((r) => r.json()),
      fetch(API.standings, { cache: "no-store" }).then((r) => r.json()),
      fetch(API.scoreboardCurrent, { cache: "no-store" }).then((r) => r.json())
    ]);

    state.chiefsData = chiefsRes;
    state.standingsData = standingsRes;

    const apiWeek = sbRes?.week?.number || 1;
    state.currentNflWeek = apiWeek;
    state.seasonYear = sbRes?.season?.year || new Date().getFullYear();
    state.seasonType = sbRes?.season?.type || 2;
    state.weekScoreboardCache[apiWeek] = sbRes;

    if (resetWeekToCurrent || !state.selectedWeek) {
      state.selectedWeek = apiWeek;
    } else if (state.selectedWeek !== apiWeek && state.activeTab === "schedule") {
      ensureWeekLoaded(state.selectedWeek, true);
    }

    state.lastUpdated = new Date();
    try {
      localStorage.setItem(
        "moms_chiefs_cache_v1",
        JSON.stringify({
          chiefsData: state.chiefsData,
          standingsData: state.standingsData,
          currentNflWeek: state.currentNflWeek,
          currentWeekScoreboard: sbRes
        })
      );
    } catch (_) {}

    renderAll();
    if (statusEl) {
      const timeStr = state.lastUpdated.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
      });
      statusEl.textContent = `Live NFL Data • Updated ${timeStr}`;
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = state.chiefsData
        ? "Showing saved NFL data (offline)"
        : "Unable to reach NFL data — tap Refresh";
    }
  }
}

function renderAll() {
  renderChiefsSection();
  renderStandingsSection();
  renderWeeklyScheduleSection();
}

/* ==========================================================================
   HELPERS FOR DATES, BROADCASTS & STANDINGS STATS
   ========================================================================== */

function getStatDisplay(statsArray, name, fallback = "0") {
  if (!Array.isArray(statsArray)) return fallback;
  const item = statsArray.find((s) => s.name === name);
  if (!item) return fallback;
  if (item.displayValue !== undefined && item.displayValue !== null) {
    return String(item.displayValue);
  }
  if (item.value !== undefined && item.value !== null) {
    return String(Math.round(Number(item.value)));
  }
  return fallback;
}

function getStatNumber(statsArray, name, fallback = 0) {
  if (!Array.isArray(statsArray)) return fallback;
  const item = statsArray.find((s) => s.name === name);
  if (!item) return fallback;
  if (item.value !== undefined && item.value !== null) return Number(item.value);
  const parsed = Number(item.displayValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractTvBroadcast(competition) {
  if (!competition) return "";
  const names = [];
  if (Array.isArray(competition.broadcasts)) {
    for (const b of competition.broadcasts) {
      if (b?.media?.shortName) names.push(b.media.shortName);
      if (Array.isArray(b?.names)) names.push(...b.names);
    }
  }
  if (Array.isArray(competition.geoBroadcasts)) {
    for (const gb of competition.geoBroadcasts) {
      if (gb?.media?.shortName) names.push(gb.media.shortName);
    }
  }
  const unique = [...new Set(names.filter(Boolean))];
  return unique.join(" / ");
}

function formatFriendlyDate(isoString, includeTime = true) {
  if (!isoString) return "Date TBD";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "Date TBD";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfGameDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfGameDay - startOfToday) / (1000 * 60 * 60 * 24));

  const dayMonth = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric"
  });
  const timePart = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });

  // Check if ESPN marks time as 05:00Z TBD
  const isTimeTbd = isoString.includes("T05:00Z") || isoString.includes("T04:00Z");
  const timeDisplay = includeTime && !isTimeTbd ? ` at ${timePart}` : "";

  if (diffDays === 0) return `TODAY (${dayMonth})${timeDisplay}`;
  if (diffDays === -1) return `Yesterday (${dayMonth})`;
  if (diffDays === 1) return `Tomorrow (${dayMonth})${timeDisplay}`;
  if (diffDays > 1 && diffDays <= 6) return `This ${dayMonth}${timeDisplay}`;
  return `${dayMonth}${timeDisplay}`;
}

function formatRelativeDayBadge(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfGameDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfGameDay - startOfToday) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Game is TODAY!";
  if (diffDays === 1) return "Game is Tomorrow!";
  if (diffDays > 1) return `In ${diffDays} days`;
  if (diffDays === -1) return "Played Yesterday";
  if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
  return "";
}

function findChiefsStandingEntry() {
  if (!state.standingsData?.children) return null;
  for (const conf of state.standingsData.children) {
    for (const div of conf.children || []) {
      for (const entry of div.standings?.entries || []) {
        if (String(entry?.team?.id) === CHIEFS_ID || entry?.team?.abbreviation === "KC") {
          return { entry, divisionName: div.name };
        }
      }
    }
  }
  return null;
}

/* ==========================================================================
   TAB 1: MY CHIEFS (HERO + LAST GAME + NEXT GAME + SEASON SCHEDULE)
   ========================================================================== */

function renderChiefsSection() {
  const container = document.getElementById("chiefs-content");
  if (!container) return;

  if (!state.chiefsData) {
    container.innerHTML = `<div class="spotlight-card"><p class="spotlight-headline">Loading Kansas City Chiefs…</p></div>`;
    return;
  }

  const team = state.chiefsData.team || {};
  const byeWeek = state.chiefsData.byeWeek || null;
  const events = state.chiefsData.events || [];
  const chiefsStanding = findChiefsStandingEntry();

  // Compute Wins - Losses - Ties in plain English
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let homeRec = "";
  let roadRec = "";

  if (chiefsStanding?.entry?.stats) {
    const st = chiefsStanding.entry.stats;
    wins = getStatNumber(st, "wins", 0);
    losses = getStatNumber(st, "losses", 0);
    ties = getStatNumber(st, "ties", 0);
    homeRec = getStatDisplay(st, "Home", "");
    roadRec = getStatDisplay(st, "Road", "");
  } else if (team.recordSummary) {
    const parts = String(team.recordSummary).split("-").map(Number);
    wins = parts[0] || 0;
    losses = parts[1] || 0;
    ties = parts[2] || 0;
  }

  const recordWords =
    `${wins} ${wins === 1 ? "Win" : "Wins"} – ${losses} ${losses === 1 ? "Loss" : "Losses"}` +
    (ties > 0 ? ` – ${ties} ${ties === 1 ? "Tie" : "Ties"}` : "");

  const standingSummary = team.standingSummary || "AFC West";

  // Parse all Chiefs games
  const parsedGames = events.map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const statusType = comp.status?.type || {};
    const stateStr = statusType.state || "pre"; // "pre" | "in" | "post"
    const completed = Boolean(statusType.completed);
    const competitors = comp.competitors || [];
    const kc = competitors.find((c) => String(c.team?.id) === CHIEFS_ID || c.team?.abbreviation === "KC") || competitors[0] || {};
    const opp = competitors.find((c) => c !== kc) || competitors[1] || {};

    const kcScore = kc.score?.displayValue ?? (typeof kc.score === "string" || typeof kc.score === "number" ? String(kc.score) : "");
    const oppScore = opp.score?.displayValue ?? (typeof opp.score === "string" || typeof opp.score === "number" ? String(opp.score) : "");
    const isHome = kc.homeAway === "home";
    const kcWon = Boolean(kc.winner);
    const oppLogo = opp.team?.logos?.[0]?.href || opp.team?.logo || "";
    const oppName = opp.team?.displayName || "Opponent";
    const tv = extractTvBroadcast(comp);
    const weekNum = ev.week?.number || null;

    return {
      id: ev.id,
      weekNum,
      weekText: ev.week?.text || (weekNum ? `Week ${weekNum}` : "Game"),
      date: ev.date,
      state: stateStr,
      completed,
      statusDetail: statusType.shortDetail || statusType.detail || "",
      isHome,
      kcScore,
      oppScore,
      kcWon,
      oppName,
      oppShort: opp.team?.shortDisplayName || oppName,
      oppLogo,
      tv
    };
  });

  const liveGame = parsedGames.find((g) => g.state === "in");
  const completedGames = parsedGames.filter((g) => g.completed || g.state === "post");
  const lastGame = completedGames.length ? completedGames[completedGames.length - 1] : null;
  const upcomingGames = parsedGames.filter((g) => g.state === "pre" && !g.completed);
  const nextGame = upcomingGames.length ? upcomingGames[0] : null;

  // Build Full Schedule with Bye Week inserted in order
  const scheduleRows = [];
  let byeInserted = false;
  for (const g of parsedGames) {
    if (byeWeek && !byeInserted && g.weekNum && g.weekNum > byeWeek) {
      scheduleRows.push({ isBye: true, weekNum: byeWeek });
      byeInserted = true;
    }
    scheduleRows.push({ isBye: false, game: g });
  }
  if (byeWeek && !byeInserted) {
    scheduleRows.push({ isBye: true, weekNum: byeWeek });
  }

  let spotlightHtml = "";

  if (liveGame) {
    spotlightHtml += `
      <div class="spotlight-card live-game-card">
        <div class="spotlight-label live-badge">● LIVE CHIEFS GAME RIGHT NOW (${escapeHtml(liveGame.statusDetail)})</div>
        <h3 class="spotlight-headline">Chiefs ${escapeHtml(liveGame.kcScore || "0")} – ${escapeHtml(liveGame.oppName)} ${escapeHtml(liveGame.oppScore || "0")}</h3>
        <div class="spotlight-matchup">
          <img class="spotlight-opp-logo" src="${escapeHtml(liveGame.oppLogo)}" alt="" />
          <div class="spotlight-opp-text">
            <div class="spotlight-opp-name">${liveGame.isHome ? "vs." : "at"} ${escapeHtml(liveGame.oppName)}</div>
            <div class="spotlight-opp-sub">${liveGame.isHome ? "Home Game in Kansas City" : "Away Game"}</div>
          </div>
        </div>
        <div class="spotlight-meta">
          ${liveGame.tv ? `<span class="tv-badge">📺 On TV: ${escapeHtml(liveGame.tv)}</span>` : ""}
        </div>
      </div>
    `;
  }

  // Last Game Card
  if (lastGame) {
    const wonBadge = lastGame.kcWon
      ? `<span class="result-badge won">✓ CHIEFS WON ${escapeHtml(lastGame.kcScore)} – ${escapeHtml(lastGame.oppScore)}</span>`
      : `<span class="result-badge lost">CHIEFS LOST ${escapeHtml(lastGame.kcScore)} – ${escapeHtml(lastGame.oppScore)}</span>`;

    const verb = lastGame.kcWon ? "Beat" : "Lost to";
    spotlightHtml += `
      <div class="spotlight-card">
        <div>
          <div class="spotlight-label">Last Game (${escapeHtml(lastGame.weekText)})</div>
          <h3 class="spotlight-headline">Chiefs ${verb} the ${escapeHtml(lastGame.oppShort)}</h3>
          <div class="spotlight-matchup">
            <img class="spotlight-opp-logo" src="${escapeHtml(lastGame.oppLogo)}" alt="" />
            <div class="spotlight-opp-text">
              <div class="spotlight-opp-name">${escapeHtml(lastGame.oppName)}</div>
              <div class="spotlight-opp-sub">${escapeHtml(formatFriendlyDate(lastGame.date, false))} • ${lastGame.isHome ? "Home Game" : "Away Game"}</div>
            </div>
          </div>
        </div>
        <div class="spotlight-meta">
          ${wonBadge}
        </div>
      </div>
    `;
  }

  // Next Game Card
  if (nextGame) {
    const relBadge = formatRelativeDayBadge(nextGame.date);
    spotlightHtml += `
      <div class="spotlight-card next-game-card">
        <div>
          <div class="spotlight-label">★ Next Chiefs Game (${escapeHtml(nextGame.weekText)})</div>
          <h3 class="spotlight-headline">${escapeHtml(formatFriendlyDate(nextGame.date, true))}</h3>
          <div class="spotlight-matchup">
            <img class="spotlight-opp-logo" src="${escapeHtml(nextGame.oppLogo)}" alt="" />
            <div class="spotlight-opp-text">
              <div class="spotlight-opp-name">${nextGame.isHome ? "vs." : "at"} ${escapeHtml(nextGame.oppName)}</div>
              <div class="spotlight-opp-sub">${nextGame.isHome ? "Home Game at Arrowhead (Kansas City)" : "Away Game"}</div>
            </div>
          </div>
        </div>
        <div class="spotlight-meta">
          ${relBadge ? `<span class="standing-pill">${escapeHtml(relBadge)}</span>` : ""}
          ${nextGame.tv ? `<span class="tv-badge">📺 TV: ${escapeHtml(nextGame.tv)}</span>` : ""}
        </div>
      </div>
    `;
  }

  // Full Chiefs Schedule HTML
  const scheduleHtml = scheduleRows
    .map((row) => {
      if (row.isBye) {
        return `
          <div class="chiefs-game-row is-bye">
            <div class="game-row-left">
              <div class="game-week-tag">Week ${row.weekNum}</div>
              <div class="game-opp-details">
                <div class="game-opp-title">BYE WEEK — Rest Week (No Chiefs Game)</div>
                <div class="game-date-line">The Chiefs have this week off</div>
              </div>
            </div>
          </div>
        `;
      }

      const g = row.game;
      const isNext = nextGame && g.id === nextGame.id;
      let rightContent = "";

      if (g.state === "in") {
        rightContent = `<span class="result-badge won">LIVE: KC ${escapeHtml(g.kcScore)} – ${escapeHtml(g.oppScore)}</span>`;
      } else if (g.completed || g.state === "post") {
        rightContent = g.kcWon
          ? `<span class="result-badge won">✓ WON ${escapeHtml(g.kcScore)}–${escapeHtml(g.oppScore)}</span>`
          : `<span class="result-badge lost">LOST ${escapeHtml(g.kcScore)}–${escapeHtml(g.oppScore)}</span>`;
      } else {
        rightContent = `
          ${isNext ? `<span class="standing-pill">★ NEXT GAME</span>` : ""}
          ${g.tv ? `<span class="tv-badge">📺 ${escapeHtml(g.tv)}</span>` : ""}
        `;
      }

      return `
        <div class="chiefs-game-row ${isNext ? "is-next" : ""}">
          <div class="game-row-left">
            <div class="game-week-tag">${escapeHtml(g.weekText)}</div>
            <img class="game-opp-logo" src="${escapeHtml(g.oppLogo)}" alt="" loading="lazy" />
            <div class="game-opp-details">
              <div class="game-opp-title">${g.isHome ? "vs." : "at"} ${escapeHtml(g.oppName)}</div>
              <div class="game-date-line">${escapeHtml(formatFriendlyDate(g.date, !g.completed))} • ${g.isHome ? "Home" : "Away"}</div>
            </div>
          </div>
          <div class="game-row-right">
            ${rightContent}
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="chiefs-hero">
      <div class="chiefs-hero-top">
        <img class="chiefs-hero-logo" src="${escapeHtml(team.logo || CHIEFS_LOGO_FALLBACK)}" alt="Kansas City Chiefs" />
        <div class="chiefs-hero-info">
          <span class="chiefs-eyebrow">★ Mom's Favorite Team</span>
          <h2 class="chiefs-hero-name">Kansas City Chiefs</h2>
          <div class="chiefs-record-big">${escapeHtml(recordWords)}</div>
          <div class="chiefs-standing-pills">
            <span class="standing-pill">🏆 ${escapeHtml(standingSummary)}</span>
            ${homeRec ? `<span class="standing-pill">Home: ${escapeHtml(homeRec)}</span>` : ""}
            ${roadRec ? `<span class="standing-pill">Away: ${escapeHtml(roadRec)}</span>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="spotlight-grid">
      ${spotlightHtml}
    </div>

    <div class="section-header">
      <h3 class="section-title">Chiefs ${state.seasonYear} Season Schedule & Results</h3>
      <p class="section-subtitle">Every game from Week 1 to Week 18</p>
    </div>
    <div class="schedule-list">
      ${scheduleHtml}
    </div>
  `;
}

/* ==========================================================================
   TAB 2: ALL 32 TEAMS STANDINGS (WINS & LOSSES)
   ========================================================================== */

function renderStandingsSection() {
  const container = document.getElementById("standings-content");
  if (!container) return;

  if (!state.standingsData?.children) {
    container.innerHTML = `<div class="spotlight-card"><p class="spotlight-headline">Loading NFL Team Standings…</p></div>`;
    return;
  }

  const allDivisions = [];
  const allTeams = [];

  for (const conf of state.standingsData.children) {
    const confShort = conf.abbreviation || (conf.name?.includes("American") ? "AFC" : "NFC");
    for (const div of conf.children || []) {
      const entries = (div.standings?.entries || []).map((e) => {
        const st = e.stats || [];
        const wins = getStatNumber(st, "wins", 0);
        const losses = getStatNumber(st, "losses", 0);
        const ties = getStatNumber(st, "ties", 0);
        const winPct = getStatNumber(st, "winPercent", 0);
        const diff = getStatNumber(st, "pointDifferential", 0);
        const isChiefs = String(e.team?.id) === CHIEFS_ID || e.team?.abbreviation === "KC";
        return {
          id: e.team?.id,
          name: e.team?.displayName || "Team",
          logo: e.team?.logos?.[0]?.href || "",
          wins,
          losses,
          ties,
          winPct,
          diff,
          isChiefs,
          divisionName: div.name,
          confShort
        };
      });

      // Sort division teams by winPct desc, then wins desc, then point diff desc
      entries.sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.diff - a.diff);
      allDivisions.push({
        name: div.name,
        confShort,
        isChiefsDivision: div.name === "AFC West",
        teams: entries
      });
      allTeams.push(...entries);
    }
  }

  // Sort divisions so AFC West (the Chiefs' division!) is ALWAYS first
  allDivisions.sort((a, b) => {
    if (a.isChiefsDivision) return -1;
    if (b.isChiefsDivision) return 1;
    if (a.confShort !== b.confShort) return a.confShort === "AFC" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  if (state.standingsFilter === "overall") {
    const ranked = [...allTeams].sort(
      (a, b) => b.winPct - a.winPct || b.wins - a.wins || b.diff - a.diff
    );
    container.innerHTML = `
      <div class="division-card">
        <div class="division-header">
          <span>All 32 NFL Teams — Ranked Best to Worst</span>
          <span>Wins – Losses</span>
        </div>
        ${ranked.map((t, idx) => renderTeamStandingRow(t, idx + 1, true)).join("")}
      </div>
    `;
    return;
  }

  const filteredDivs = allDivisions.filter((d) => {
    if (state.standingsFilter === "afc") return d.confShort === "AFC";
    if (state.standingsFilter === "nfc") return d.confShort === "NFC";
    return true;
  });

  container.innerHTML = `
    <div class="divisions-grid two-col">
      ${filteredDivs
        .map(
          (div) => `
        <div class="division-card ${div.isChiefsDivision ? "chiefs-division" : ""}">
          <div class="division-header">
            <span>${escapeHtml(div.name)} ${div.isChiefsDivision ? "★ (Chiefs' Division)" : ""}</span>
            <span>W – L</span>
          </div>
          ${div.teams.map((t, idx) => renderTeamStandingRow(t, idx + 1, false)).join("")}
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

function renderTeamStandingRow(team, rankNum, showDivisionSub) {
  const wlNumbers =
    `${team.wins} – ${team.losses}` + (team.ties > 0 ? ` – ${team.ties}` : "");
  const wlWords =
    `${team.wins} ${team.wins === 1 ? "Win" : "Wins"}, ${team.losses} ${team.losses === 1 ? "Loss" : "Losses"}` +
    (team.ties > 0 ? `, ${team.ties} Tie` : "");

  return `
    <div class="team-standing-row ${team.isChiefs ? "is-chiefs" : ""}">
      <div class="team-standing-left">
        <div class="team-rank-num">${rankNum}</div>
        <img class="team-standing-logo" src="${escapeHtml(team.logo)}" alt="" loading="lazy" />
        <div class="team-standing-name-wrap">
          <div class="team-standing-name">${escapeHtml(team.name)}</div>
          ${team.isChiefs ? `<span class="my-chiefs-tag">★ MOM'S CHIEFS</span>` : ""}
          ${!team.isChiefs && showDivisionSub ? `<div class="team-wl-words">${escapeHtml(team.divisionName)}</div>` : ""}
        </div>
      </div>
      <div class="team-standing-right">
        <div class="team-wl-Main">${escapeHtml(wlNumbers)}</div>
        <div class="team-wl-words">${escapeHtml(wlWords)}</div>
      </div>
    </div>
  `;
}

/* ==========================================================================
   TAB 3: NFL SCHEDULE BY WEEK (ALL GAMES FOR ANY WEEK)
   ========================================================================== */

function changeScheduleWeek(delta) {
  const next = Math.max(1, Math.min(18, state.selectedWeek + delta));
  selectScheduleWeek(next);
}

function selectScheduleWeek(weekNum) {
  state.selectedWeek = Number(weekNum) || state.currentNflWeek;
  renderWeeklyScheduleSection();
  ensureWeekLoaded(state.selectedWeek);
}

async function ensureWeekLoaded(weekNum, forceRefresh = false) {
  if (!forceRefresh && state.weekScoreboardCache[weekNum]) {
    renderWeeklyScheduleSection();
    return;
  }
  try {
    const res = await fetch(API.scoreboardWeek(weekNum, 2), { cache: "no-store" }).then((r) =>
      r.json()
    );
    state.weekScoreboardCache[weekNum] = res;
    renderWeeklyScheduleSection();
  } catch (_) {}
}

function renderWeeklyScheduleSection() {
  const navContainer = document.getElementById("week-nav-container");
  const gamesContainer = document.getElementById("weekly-games-container");
  if (!navContainer || !gamesContainer) return;

  const week = state.selectedWeek || state.currentNflWeek || 1;
  const isCurrent = week === state.currentNflWeek;

  // Build week options 1..18
  const optionsHtml = Array.from({ length: 18 }, (_, i) => i + 1)
    .map(
      (w) =>
        `<option value="${w}" ${w === week ? "selected" : ""}>Week ${w}${
          w === state.currentNflWeek ? " (Current Week)" : ""
        }</option>`
    )
    .join("");

  navContainer.innerHTML = `
    <div class="week-nav-card">
      <div class="week-nav-main">
        <button class="week-step-btn" onclick="changeScheduleWeek(-1)" ${
          week <= 1 ? "disabled" : ""
        }>◀ Week ${Math.max(1, week - 1)}</button>
        <div class="week-center-title">
          <select class="week-select-dropdown" aria-label="Select NFL Week" onchange="selectScheduleWeek(this.value)">
            ${optionsHtml}
          </select>
          <span class="week-current-badge">${
            isCurrent ? "✓ Showing Current NFL Week" : `Current NFL Week is Week ${state.currentNflWeek}`
          }</span>
        </div>
        <button class="week-step-btn" onclick="changeScheduleWeek(1)" ${
          week >= 18 ? "disabled" : ""
        }>Week ${Math.min(18, week + 1)} ▶</button>
      </div>
      ${
        !isCurrent
          ? `<button class="jump-current-week-btn" onclick="selectScheduleWeek(${state.currentNflWeek})">↩ Jump Back to Current Week (Week ${state.currentNflWeek})</button>`
          : ""
      }
    </div>
  `;

  const sb = state.weekScoreboardCache[week];
  if (!sb) {
    gamesContainer.innerHTML = `<div class="spotlight-card"><p class="spotlight-headline">Loading Week ${week} NFL Games…</p></div>`;
    return;
  }

  const events = sb.events || [];
  const teamsOnBye = sb.week?.teamsOnBye || [];
  const chiefsOnBye =
    teamsOnBye.some((t) => String(t.id) === CHIEFS_ID || t.abbreviation === "KC") ||
    state.chiefsData?.byeWeek === week;

  // Find Chiefs game in this week
  const chiefsEvent = events.find((ev) => {
    const comps = ev.competitions?.[0]?.competitors || [];
    return comps.some((c) => String(c.team?.id) === CHIEFS_ID || c.team?.abbreviation === "KC");
  });

  let pinnedChiefsHtml = "";
  if (chiefsEvent) {
    pinnedChiefsHtml = `
      <div class="section-header">
        <h3 class="section-title">★ Chiefs Game in Week ${week}</h3>
      </div>
      <div class="weekly-games-grid">
        ${renderNflGameCard(chiefsEvent, true)}
      </div>
    `;
  } else if (chiefsOnBye) {
    pinnedChiefsHtml = `
      <div class="chiefs-game-row is-bye" style="margin-bottom: 18px;">
        <div class="game-row-left">
          <div class="game-week-tag">★ CHIEFS</div>
          <div class="game-opp-details">
            <div class="game-opp-title">Kansas City Chiefs are on their BYE WEEK in Week ${week}</div>
            <div class="game-date-line">Rest week — the Chiefs do not play a game in Week ${week}.</div>
          </div>
        </div>
      </div>
    `;
  }

  // Group all games by calendar day in local time
  const groups = new Map();
  for (const ev of events) {
    const d = new Date(ev.date);
    const dayKey = isNaN(d.getTime())
      ? "Scheduled Games"
      : d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric"
        });
    if (!groups.has(dayKey)) groups.set(dayKey, []);
    groups.get(dayKey).push(ev);
  }

  let daysHtml = "";
  for (const [dayLabel, dayEvents] of groups.entries()) {
    daysHtml += `
      <div class="day-group-header">${escapeHtml(dayLabel)}</div>
      <div class="weekly-games-grid">
        ${dayEvents.map((ev) => renderNflGameCard(ev, false)).join("")}
      </div>
    `;
  }

  // Teams on Bye summary at bottom
  let byeTeamsHtml = "";
  if (teamsOnBye.length > 0) {
    const names = teamsOnBye.map((t) => t.displayName || t.name).join(", ");
    byeTeamsHtml = `
      <div class="chiefs-game-row is-bye" style="margin-top: 22px;">
        <div class="game-opp-details">
          <div class="game-opp-title">Teams on Bye (Off) in Week ${week}:</div>
          <div class="game-date-line">${escapeHtml(names)}</div>
        </div>
      </div>
    `;
  }

  gamesContainer.innerHTML = pinnedChiefsHtml + daysHtml + byeTeamsHtml;
}

function renderNflGameCard(ev, isPinnedBanner) {
  const comp = ev.competitions?.[0] || {};
  const statusType = comp.status?.type || {};
  const stateStr = statusType.state || "pre";
  const completed = Boolean(statusType.completed);
  const competitors = comp.competitors || [];

  const away = competitors.find((c) => c.homeAway === "away") || competitors[0] || {};
  const home = competitors.find((c) => c.homeAway === "home") || competitors[1] || {};
  const hasChiefs =
    String(away.team?.id) === CHIEFS_ID ||
    String(home.team?.id) === CHIEFS_ID ||
    away.team?.abbreviation === "KC" ||
    home.team?.abbreviation === "KC";

  const tv = extractTvBroadcast(comp);
  let topStatusText = "";
  if (stateStr === "in") {
    topStatusText = `● LIVE • ${statusType.shortDetail || "In Progress"}`;
  } else if (completed || stateStr === "post") {
    topStatusText = statusType.shortDetail || "Final";
  } else {
    topStatusText = formatFriendlyDate(ev.date, true);
  }

  const showScores = stateStr === "in" || completed || stateStr === "post";

  return `
    <div class="nfl-game-card ${hasChiefs ? "is-chiefs-game" : ""}">
      <div class="nfl-game-top">
        <span>${hasChiefs && !isPinnedBanner ? "★ CHIEFS GAME • " : ""}${escapeHtml(topStatusText)}</span>
        ${tv && !completed ? `<span class="tv-badge">📺 ${escapeHtml(tv)}</span>` : ""}
      </div>
      ${renderCompetitorLine(away, showScores, "Away")}
      ${renderCompetitorLine(home, showScores, "Home")}
    </div>
  `;
}

function renderCompetitorLine(compItem, showScore, roleLabel) {
  const team = compItem.team || {};
  const logo = team.logo || team.logos?.[0]?.href || "";
  const name = team.displayName || team.name || "Team";
  const rec = (compItem.records || []).find((r) => r.type === "total" || r.name === "overall")?.summary || "";
  const score = compItem.score?.displayValue ?? compItem.score ?? "";
  const isWinner = Boolean(compItem.winner);

  return `
    <div class="nfl-team-line ${isWinner ? "winner-line" : ""}">
      <div class="nfl-team-left">
        <img class="nfl-team-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" />
        <div>
          <span class="nfl-team-name">${escapeHtml(name)}</span>
          ${rec ? `<span class="nfl-team-record">(${escapeHtml(rec)})</span>` : `<span class="nfl-team-record">(${roleLabel})</span>`}
        </div>
      </div>
      <div class="nfl-team-score">
        ${showScore ? escapeHtml(String(score)) : ""}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", initApp);
