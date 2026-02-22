const REFRESH_INTERVAL_MS = 15000;
const brandingApi = window.ncaabsbBranding || null;

const state = {
  selectedGameId: null,
  timer: null,
};

const elements = {
  awayLogo: document.getElementById("away-logo"),
  homeLogo: document.getElementById("home-logo"),
  awayScore: document.getElementById("away-score"),
  homeScore: document.getElementById("home-score"),
  baseFirst: document.getElementById("base-first"),
  baseSecond: document.getElementById("base-second"),
  baseThird: document.getElementById("base-third"),
  gameStatus: document.getElementById("game-status"),
  outsStatus: document.getElementById("outs-status"),
  pitcherLine: document.getElementById("pitcher-line"),
  batterLine: document.getElementById("batter-line"),
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
    if (elements.gameStatus) {
      elements.gameStatus.textContent = "Feed Error";
    }
    if (elements.outsStatus) {
      elements.outsStatus.textContent = "";
    }
    if (elements.pitcherLine) {
      elements.pitcherLine.textContent = "PITCHER - -";
    }
    if (elements.batterLine) {
      elements.batterLine.textContent = "BATTER - -";
    }
    if (elements.playFeed) {
      elements.playFeed.innerHTML = `<p class="empty">Load failed: ${message}</p>`;
    }
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

  if (selectedGameId) {
    state.selectedGameId = selectedGameId;
  }

  renderScoreboard(summary, selectedGame);
  renderFeed(plays);
}

function renderScoreboard(summary, selectedGame) {
  const awayTeam = summary?.visitorTeam || selectedGame?.awayTeam || "Away";
  const homeTeam = summary?.homeTeam || selectedGame?.homeTeam || "Home";
  const situation = summary?.situation || null;

  renderTeamLogo(elements.awayLogo, awayTeam);
  renderTeamLogo(elements.homeLogo, homeTeam);

  elements.awayScore.textContent = formatScore(summary?.visitorScore);
  elements.homeScore.textContent = formatScore(summary?.homeScore);

  renderBaseDiamond(situation?.bases || null);
  renderInningIndicator(elements.gameStatus, summary, selectedGame);
  renderOutsDots(elements.outsStatus, situation);
  renderMatchupStrip(situation);
  applyStripBranding(awayTeam, homeTeam);
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

function renderMatchupStrip(situation) {
  if (elements.pitcherLine) {
    const pitcher = normalizePlayerLabel(situation?.pitcher?.name);
    elements.pitcherLine.textContent = `PITCHER - ${pitcher}`;
  }

  if (elements.batterLine) {
    const batter = normalizePlayerLabel(situation?.batter?.name);
    elements.batterLine.textContent = `BATTER - ${batter}`;
  }
}

function applyStripBranding(awayTeam, homeTeam) {
  const away = getTeamPrimaryColor(awayTeam) || "#8a0014";
  const home = getTeamPrimaryColor(homeTeam) || "#070707";

  applyStripColors(elements.pitcherLine, away);
  applyStripColors(elements.batterLine, home);
}

function getTeamPrimaryColor(teamName) {
  if (!brandingApi || typeof brandingApi.lookup !== "function") {
    return null;
  }
  const branding = brandingApi.lookup(teamName);
  const safeColor = brandingApi.safeColor;
  if (typeof safeColor !== "function") {
    return null;
  }

  return safeColor(branding?.colors?.primary) || safeColor(branding?.colors?.espnPrimary) || null;
}

function applyStripColors(node, background) {
  if (!node) {
    return;
  }
  node.style.backgroundColor = background;
  node.style.color = chooseReadableTextColor(background);
}

function chooseReadableTextColor(hexColor) {
  const clean = String(hexColor || "").replace(/^#/u, "");
  if (!/^[0-9a-fA-F]{6}$/u.test(clean)) {
    return "#F8FBFF";
  }

  const red = Number.parseInt(clean.slice(0, 2), 16);
  const green = Number.parseInt(clean.slice(2, 4), 16);
  const blue = Number.parseInt(clean.slice(4, 6), 16);
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  return luminance > 150 ? "#0B0E14" : "#F8FBFF";
}

function normalizePlayerLabel(value) {
  const text = prettifyNames(value || "").trim().toUpperCase();
  return text.length > 0 ? text : "-";
}

function renderBaseDiamond(bases) {
  setBaseOccupied(elements.baseFirst, Boolean(bases?.first));
  setBaseOccupied(elements.baseSecond, Boolean(bases?.second));
  setBaseOccupied(elements.baseThird, Boolean(bases?.third));
}

function setBaseOccupied(node, occupied) {
  if (!node) {
    return;
  }
  node.classList.toggle("is-occupied", occupied);
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
