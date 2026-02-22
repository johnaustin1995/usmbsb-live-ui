const REFRESH_INTERVAL_MS = 15000;
const brandingApi = window.ncaabsbBranding || null;

const state = {
  selectedGameId: null,
  timer: null,
};

const elements = {
  awayName: document.getElementById("away-name"),
  homeName: document.getElementById("home-name"),
  awayLogo: document.getElementById("away-logo"),
  homeLogo: document.getElementById("home-logo"),
  awayScore: document.getElementById("away-score"),
  homeScore: document.getElementById("home-score"),
  gameStatus: document.getElementById("game-status"),
  outsStatus: document.getElementById("outs-status"),
  statusMeta: document.getElementById("status-meta"),
  feedCount: document.getElementById("feed-count"),
  playFeed: document.getElementById("play-feed"),
};

void init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const idParam = Number.parseInt(params.get("id") || "", 10);
  state.selectedGameId = Number.isFinite(idParam) ? idParam : null;

  await loadBranding();
  await fetchAndRender();

  state.timer = setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
}

async function loadBranding() {
  if (!brandingApi || typeof brandingApi.load !== "function") {
    return;
  }

  try {
    await brandingApi.load();
  } catch (_error) {
    // Branding is optional for OBS mode.
  }
}

async function fetchAndRender() {
  try {
    const payload = await fetchLivePayload(state.selectedGameId);
    render(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    elements.statusMeta.textContent = `Load failed: ${message}`;
  }
}

async function fetchLivePayload(gameId) {
  const url = new URL("/api/usm/live", window.location.origin);
  if (gameId) {
    url.searchParams.set("id", String(gameId));
  }

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error || `Request failed (${response.status})`);
  }

  return response.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function render(payload) {
  const selectedGameId = payload.selectedGameId || null;
  const selectedGame = payload.selectedGame || null;
  const live = payload.live || {};
  const summary = live.summary || null;
  const plays = Array.isArray(live.plays) ? live.plays : [];
  const summaryError = live.summaryError || null;

  if (selectedGameId) {
    state.selectedGameId = selectedGameId;
  }

  renderMeta(summary, selectedGame, summaryError, payload.nowEpoch);
  renderScoreboard(summary, selectedGame);
  renderFeed(plays);
}

function renderMeta(summary, selectedGame, summaryError, nowEpoch) {
  const now = nowEpoch ? new Date(nowEpoch * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();
  if (summaryError) {
    elements.statusMeta.textContent = `StatBroadcast unavailable (${summaryError}) | ${now}`;
    return;
  }

  const away = summary?.visitorTeam || selectedGame?.awayTeam || "Away";
  const home = summary?.homeTeam || selectedGame?.homeTeam || "Home";
  const idPart = state.selectedGameId ? `Game ${state.selectedGameId}` : "No game id";
  elements.statusMeta.textContent = `${away} at ${home} | ${idPart} | ${now}`;
}

function renderScoreboard(summary, selectedGame) {
  const awayTeam = summary?.visitorTeam || selectedGame?.awayTeam || "Away";
  const homeTeam = summary?.homeTeam || selectedGame?.homeTeam || "Home";

  elements.awayName.textContent = formatTeamDisplayName(awayTeam);
  elements.homeName.textContent = formatTeamDisplayName(homeTeam);
  renderTeamLogo(elements.awayLogo, awayTeam);
  renderTeamLogo(elements.homeLogo, homeTeam);

  elements.awayScore.textContent = formatScore(summary?.visitorScore);
  elements.homeScore.textContent = formatScore(summary?.homeScore);

  renderInningIndicator(elements.gameStatus, summary, selectedGame);
  renderOutsDots(elements.outsStatus, summary?.situation || null);
}

function renderTeamLogo(logoEl, teamName) {
  if (!logoEl) {
    return;
  }

  if (!brandingApi || typeof brandingApi.lookup !== "function" || typeof brandingApi.chooseLogo !== "function") {
    logoEl.hidden = true;
    logoEl.removeAttribute("src");
    return;
  }

  const branding = brandingApi.lookup(teamName);
  const logoSrc = brandingApi.chooseLogo(branding, { preferDark: false });
  if (!logoSrc) {
    logoEl.hidden = true;
    logoEl.removeAttribute("src");
    return;
  }

  logoEl.src = logoSrc;
  logoEl.alt = `${teamName} logo`;
  logoEl.hidden = false;
}

function renderFeed(plays) {
  const ordered = [...plays].reverse();
  elements.feedCount.textContent = `${ordered.length} plays`;
  elements.playFeed.innerHTML = "";

  if (ordered.length === 0) {
    elements.playFeed.innerHTML = '<p class="empty">No play-by-play data yet.</p>';
    return;
  }

  let previousHalfInning = null;

  for (const play of ordered) {
    const halfInningLabel = toHalfInningLabel(play);
    if (halfInningLabel && halfInningLabel !== previousHalfInning) {
      const divider = document.createElement("div");
      divider.className = "feed-divider";
      divider.textContent = halfInningLabel;
      elements.playFeed.append(divider);
      previousHalfInning = halfInningLabel;
    }

    const item = document.createElement("article");
    item.className = "feed-item";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${formatInning(play)} | ${formatScore(play.awayScore)}-${formatScore(play.homeScore)}`;

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = prettifyNames(play.text || "");

    item.append(meta);
    item.append(text);

    const tag = classifyPlay(play.text || "");
    if (tag) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = tag;
      item.append(chip);
    }

    elements.playFeed.append(item);
  }
}

function toHalfInningLabel(play) {
  if (!play || !Number.isFinite(play.inning) || !play.half) {
    return null;
  }
  return `${play.half === "top" ? "top" : "bot"} ${play.inning}`;
}

function buildInningIndicator(summary, selectedGame) {
  const situation = summary?.situation || null;
  const inningFromSituation = Number.isFinite(situation?.inning) ? Number(situation.inning) : null;
  const halfFromSituation = normalizeHalf(situation?.half);
  if (inningFromSituation !== null && halfFromSituation) {
    return {
      half: halfFromSituation,
      inning: inningFromSituation,
      text: null,
    };
  }

  const statusText = String(summary?.statusText || selectedGame?.statusText || "Pregame");
  const parsed = parseInningFromStatus(statusText);
  if (parsed) {
    return {
      half: parsed.half,
      inning: parsed.inning,
      text: null,
    };
  }

  return {
    half: null,
    inning: null,
    text: statusText,
  };
}

function renderInningIndicator(target, summary, selectedGame) {
  target.replaceChildren();
  const indicator = buildInningIndicator(summary, selectedGame);
  if (indicator.half && Number.isFinite(indicator.inning)) {
    const arrow = document.createElement("span");
    arrow.className = "inning-arrow";
    arrow.textContent = indicator.half === "top" ? "▲" : "▼";

    const number = document.createElement("span");
    number.className = "inning-number";
    number.textContent = String(indicator.inning);

    target.append(arrow, number);
    return;
  }

  target.textContent = indicator.text || "Pregame";
}

function renderOutsDots(target, situation) {
  target.replaceChildren();
  const outsRaw = Number.isFinite(situation?.outs) ? Math.trunc(Number(situation.outs)) : 0;
  const outs = Math.max(0, Math.min(3, outsRaw));

  const wrap = document.createElement("span");
  wrap.className = "outs-dots";
  wrap.setAttribute("aria-label", `${outs} ${outs === 1 ? "out" : "outs"}`);

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement("span");
    dot.className = `out-dot${index < outs ? " is-filled" : ""}`;
    wrap.append(dot);
  }

  target.append(wrap);
}

function parseInningFromStatus(text) {
  const match = String(text || "").match(/\b(top|bot|bottom)\b(?:\s+of)?(?:\s+the)?\s*(\d+)/i);
  if (!match) {
    return null;
  }
  const inning = Number.parseInt(match[2], 10);
  if (!Number.isFinite(inning)) {
    return null;
  }
  return {
    half: /^top/i.test(match[1]) ? "top" : "bottom",
    inning,
  };
}

function normalizeHalf(value) {
  const text = String(value || "").toLowerCase();
  if (text === "top") {
    return "top";
  }
  if (text === "bottom" || text === "bot") {
    return "bottom";
  }
  return null;
}

function formatInning(play) {
  if (!play || play.inning === null || !play.half) {
    return "Inning ?";
  }
  return `${play.half === "top" ? "Top" : "Bot"} ${play.inning}`;
}

function classifyPlay(text) {
  const lower = text.toLowerCase();
  if (lower.includes("home run") || lower.includes("homered")) return "Home Run";
  if (lower.includes("doubled")) return "Double";
  if (lower.includes("tripled")) return "Triple";
  if (lower.includes("singled")) return "Single";
  if (lower.includes("walked")) return "Walk";
  if (lower.includes("struck out")) return "Strikeout";
  if (lower.includes("pinch hit")) return "Pinch Hit";
  if (lower.includes("to p for")) return "Pitching Change";
  if (lower.includes("stole")) return "Stolen Base";
  return "";
}

function formatTeamDisplayName(name) {
  const clean = String(name || "").replace(/^#\d+\s+/, "").trim();
  return clean || "-";
}

function prettifyNames(text) {
  if (!text) return "";
  return text
    .replace(/\b([A-Za-z][A-Za-z'.-]+),\s*([A-Za-z][A-Za-z'.-]+)\b/g, (_m, last, first) => {
      return `${toTitle(first)} ${toTitle(last)}`;
    })
    .replace(/\b([A-Z]{3,})\b/g, (word) => (word === word.toUpperCase() ? toTitle(word) : word));
}

function toTitle(value) {
  return String(value)
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((token) => (/^[\s-']+$/.test(token) ? token : token.charAt(0).toUpperCase() + token.slice(1)))
    .join("");
}

function formatScore(value) {
  return Number.isFinite(value) ? String(value) : "-";
}
