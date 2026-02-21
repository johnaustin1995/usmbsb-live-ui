const REFRESH_INTERVAL_MS = 15000;
const brandingApi = window.ncaabsbBranding || null;

const state = {
  selectedGameId: null,
  autoRefresh: true,
  timer: null,
};

const elements = {
  statusMeta: document.getElementById("status-meta"),
  gameSelect: document.getElementById("game-select"),
  refreshBtn: document.getElementById("refresh-btn"),
  autoRefresh: document.getElementById("auto-refresh"),
  feedCount: document.getElementById("feed-count"),
  playFeed: document.getElementById("play-feed"),
  awayCode: document.getElementById("away-code"),
  homeCode: document.getElementById("home-code"),
  awayLogo: document.getElementById("away-logo"),
  homeLogo: document.getElementById("home-logo"),
  awayRecord: document.getElementById("away-record"),
  homeRecord: document.getElementById("home-record"),
  awayScore: document.getElementById("away-score"),
  homeScore: document.getElementById("home-score"),
  gameStatus: document.getElementById("game-status"),
  countStatus: document.getElementById("count-status"),
  pitcherName: document.getElementById("pitcher-name"),
  batterName: document.getElementById("batter-name"),
  baseState: document.getElementById("base-state"),
  lineScore: document.getElementById("line-score"),
  battingTable: document.getElementById("batting-table"),
  pitchingTable: document.getElementById("pitching-table"),
  sprayLayer: document.getElementById("spray-layer"),
};

void init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const idParam = Number.parseInt(params.get("id") || "", 10);
  state.selectedGameId = Number.isFinite(idParam) ? idParam : null;

  elements.refreshBtn.addEventListener("click", () => fetchAndRender());
  elements.autoRefresh.addEventListener("change", () => {
    state.autoRefresh = elements.autoRefresh.checked;
    resetTimer();
  });

  elements.gameSelect.addEventListener("change", () => {
    const id = Number.parseInt(elements.gameSelect.value, 10);
    state.selectedGameId = Number.isFinite(id) ? id : null;
    updateQueryString(state.selectedGameId);
    fetchAndRender();
  });

  await loadBranding();
  fetchAndRender();
  resetTimer();
}

async function loadBranding() {
  if (!brandingApi || typeof brandingApi.load !== "function") {
    return;
  }

  try {
    await brandingApi.load();
  } catch (_error) {
    // Branding is optional; keep UI functional without it.
  }
}

function resetTimer() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.autoRefresh) {
    state.timer = setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
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
  const schedule = Array.isArray(payload.schedule) ? payload.schedule : [];
  const live = payload.live || {};
  const summary = live.summary || null;
  const plays = Array.isArray(live.plays) ? live.plays : [];
  const gameSections = Array.isArray(live.gameSections) ? live.gameSections : [];

  if (selectedGameId) {
    state.selectedGameId = selectedGameId;
    updateQueryString(selectedGameId);
  }

  renderGameSelect(schedule, selectedGameId);
  renderHeaderMeta(payload, summary, live.summaryError);
  renderScoreBanner(summary, selectedGame);
  renderFeed(plays);
  renderDuel(summary);
  renderLineScore(summary?.lineScore || null);
  renderTables(gameSections);
  renderSpray(plays);
}

function renderHeaderMeta(payload, summary, summaryError) {
  const now = payload.nowEpoch ? new Date(payload.nowEpoch * 1000).toLocaleString() : new Date().toLocaleString();
  if (summaryError) {
    elements.statusMeta.textContent = `StatBroadcast not open yet (${summaryError}). Last check: ${now}`;
    return;
  }
  if (!summary) {
    elements.statusMeta.textContent = `No live summary available. Last check: ${now}`;
    return;
  }
  elements.statusMeta.textContent = `${summary.visitorTeam} at ${summary.homeTeam} | Refreshed ${now}`;
}

function renderGameSelect(games, selectedGameId) {
  const previous = elements.gameSelect.value;
  elements.gameSelect.innerHTML = "";

  for (const game of games) {
    const option = document.createElement("option");
    option.value = String(game.gameId);
    const date = game.date || "";
    const status = game.statusText || "";
    option.textContent = `${date} | ${status} ET | ${game.awayTeam} at ${game.homeTeam}`;
    if (game.gameId === selectedGameId) {
      option.selected = true;
    }
    elements.gameSelect.append(option);
  }

  if (!elements.gameSelect.value && previous) {
    elements.gameSelect.value = previous;
  }
}

function renderScoreBanner(summary, selectedGame) {
  const awayTeam = summary?.visitorTeam || selectedGame?.awayTeam || "Away";
  const homeTeam = summary?.homeTeam || selectedGame?.homeTeam || "Home";
  const awayTeamName = formatTeamDisplayName(awayTeam);
  const homeTeamName = formatTeamDisplayName(homeTeam);
  const awayScore = formatScore(summary?.visitorScore);
  const homeScore = formatScore(summary?.homeScore);

  elements.awayCode.textContent = awayTeamName;
  elements.homeCode.textContent = homeTeamName;
  elements.awayRecord.textContent = "";
  elements.homeRecord.textContent = "";
  renderTeamLogo(elements.awayLogo, awayTeam);
  renderTeamLogo(elements.homeLogo, homeTeam);
  elements.awayScore.textContent = awayScore;
  elements.homeScore.textContent = homeScore;
  elements.gameStatus.textContent = buildInningIndicator(summary, selectedGame);
  elements.countStatus.textContent = buildCountLine(summary?.situation || null);
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
  const recent = [...plays].reverse().slice(0, 36);
  elements.feedCount.textContent = `${recent.length} recent plays`;
  elements.playFeed.innerHTML = "";

  if (recent.length === 0) {
    elements.playFeed.innerHTML = '<p class="empty">No play-by-play data yet.</p>';
    return;
  }

  for (const play of recent) {
    const item = document.createElement("article");
    item.className = "feed-item";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${formatInning(play)} | ${formatOuts(play.outsAfterPlay)} | ${formatScore(play.awayScore)}-${formatScore(play.homeScore)}`;

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

function renderDuel(summary) {
  const situation = summary?.situation || null;
  elements.pitcherName.textContent = prettifyNames(situation?.pitcher?.name || "-");
  elements.batterName.textContent = prettifyNames(situation?.batter?.name || "-");
  elements.baseState.textContent = formatBaseState(situation?.bases || null);
}

function renderLineScore(lineScore) {
  if (!lineScore || !Array.isArray(lineScore.rows) || lineScore.rows.length === 0) {
    elements.lineScore.innerHTML = '<p class="empty">Line score not available.</p>';
    return;
  }

  const headers = Array.isArray(lineScore.headers) ? lineScore.headers : [];
  const inningHeaders = headers.filter((header) => /^\d+$/.test(String(header)));
  const tailHeaders = headers.filter((header) => !/^\d+$/.test(String(header)));

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);

  const hr = document.createElement("tr");
  hr.append(th("Team"));
  for (const inning of inningHeaders) {
    hr.append(th(String(inning)));
  }
  for (const key of tailHeaders) {
    hr.append(th(String(key)));
  }
  thead.append(hr);

  for (const row of lineScore.rows) {
    const tr = document.createElement("tr");
    tr.append(td(row.team || ""));
    for (const inning of inningHeaders) {
      const value = row.columns?.[inning.toLowerCase()] ?? row.columns?.[inning] ?? "";
      tr.append(td(formatCell(value)));
    }
    for (const key of tailHeaders) {
      const lower = String(key).toLowerCase();
      const value = row.columns?.[lower] ?? row.columns?.[key] ?? "";
      tr.append(td(formatCell(value)));
    }
    tbody.append(tr);
  }

  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  wrap.append(table);
  elements.lineScore.innerHTML = "";
  elements.lineScore.append(wrap);
}

function renderTables(sections) {
  const battingSections = sections.filter((section) => /batting order/i.test(section.title)).slice(0, 2);
  const pitchingSections = sections.filter((section) => /^pitching/i.test(section.title)).slice(0, 2);

  elements.battingTable.innerHTML = "";
  elements.pitchingTable.innerHTML = "";

  renderSectionTables(elements.battingTable, battingSections, "Batting not available.");
  renderSectionTables(elements.pitchingTable, pitchingSections, "Pitching not available.");
}

function renderSectionTables(target, sections, emptyMessage) {
  if (!sections.length) {
    target.innerHTML = `<p class="empty">${emptyMessage}</p>`;
    return;
  }

  for (const section of sections) {
    const heading = document.createElement("div");
    heading.className = "empty";
    heading.style.padding = "10px 12px 6px";
    heading.style.fontWeight = "700";
    heading.style.color = "#d6e5ff";
    heading.textContent = section.title;
    target.append(heading);

    const tableData = section.tables?.[0];
    if (!tableData) {
      continue;
    }

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.append(thead, tbody);

    const hr = document.createElement("tr");
    const headers = (tableData.headers || []).slice(0, 7);
    headers.forEach((header) => hr.append(th(String(header || ""))));
    thead.append(hr);

    const rows = (tableData.rows || []).slice(0, 12);
    for (const row of rows) {
      const tr = document.createElement("tr");
      const cells = (row.cells || []).slice(0, headers.length);
      for (let index = 0; index < headers.length; index += 1) {
        tr.append(td(formatCell(cells[index])));
      }
      tbody.append(tr);
    }

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    wrap.append(table);
    target.append(wrap);
  }
}

function renderSpray(plays) {
  elements.sprayLayer.innerHTML = "";
  const candidates = [...plays]
    .filter((play) => !play.isSubstitution)
    .reverse()
    .filter((play) => isBattedBallPlay(play.text || ""))
    .slice(0, 8);

  const homeX = 500;
  const homeY = 610;

  candidates.forEach((play, index) => {
    const spray = estimateSpray(play.text || "");
    if (!spray) {
      return;
    }

    const radians = (spray.angle * Math.PI) / 180;
    const radius = (Math.min(430, spray.distance) / 430) * 340;
    const endX = homeX + Math.sin(radians) * radius;
    const endY = homeY - Math.cos(radians) * radius;
    const controlX = homeX + Math.sin(radians) * radius * 0.52 + (index % 2 === 0 ? 8 : -8);
    const controlY = homeY - Math.cos(radians) * radius * 0.62 - 18;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${homeX} ${homeY} Q ${controlX} ${controlY} ${endX} ${Math.max(95, endY)}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", spray.color);
    path.setAttribute("stroke-width", index === 0 ? "4" : "3");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("opacity", String(Math.max(0.35, 1 - index * 0.1)));

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", String(endX));
    marker.setAttribute("cy", String(Math.max(95, endY)));
    marker.setAttribute("r", "6");
    marker.setAttribute("fill", spray.color);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(endX + 10));
    label.setAttribute("y", String(Math.max(95, endY) - 8));
    label.setAttribute("fill", "#f1f5ff");
    label.setAttribute("font-size", "18");
    label.setAttribute("font-weight", "700");
    label.textContent = spray.label;

    elements.sprayLayer.append(path, marker, label);
  });
}

function estimateSpray(text) {
  const lower = text.toLowerCase();

  let label = "BIP";
  let distance = 250;
  let color = "#89c8ff";

  if (/home run|homered/.test(lower)) {
    label = "HR";
    distance = 405;
    color = "#f3c13f";
  } else if (/tripled|triple/.test(lower)) {
    label = "3B";
    distance = 350;
    color = "#9ce9ff";
  } else if (/doubled|double/.test(lower)) {
    label = "2B";
    distance = 305;
    color = "#67d8ff";
  } else if (/singled|single/.test(lower)) {
    label = "1B";
    distance = 235;
    color = "#57b9ff";
  } else if (/grounded out/.test(lower)) {
    label = "GO";
    distance = 170;
    color = "#ffc27f";
  } else if (/lined out/.test(lower)) {
    label = "LO";
    distance = 250;
    color = "#ffc27f";
  } else if (/flied out|fly out|infield fly|popped up/.test(lower)) {
    label = "FO";
    distance = /infield/.test(lower) ? 140 : 260;
    color = "#ffc27f";
  }

  let angle = 0;
  if (/left center/.test(lower)) {
    angle = -28;
  } else if (/right center/.test(lower)) {
    angle = 28;
  } else if (/center/.test(lower)) {
    angle = 0;
  } else if (/left field|left side|third base|shortstop/.test(lower)) {
    angle = -52;
  } else if (/right field|right side|first base|second base/.test(lower)) {
    angle = 52;
  } else if (/pitcher|catcher/.test(lower)) {
    angle = 0;
    distance = Math.min(distance, 120);
  }

  return { label, distance, angle, color };
}

function isBattedBallPlay(text) {
  return /singled|doubled|tripled|homered|home run|flied out|lined out|grounded out|popped up|infield fly|reached on/.test(
    text.toLowerCase()
  );
}

function buildCountLine(situation) {
  if (!situation) {
    return "No count data";
  }
  const balls = valueOrQuestion(situation.count?.balls);
  const strikes = valueOrQuestion(situation.count?.strikes);
  const outs = formatOuts(situation.outs);
  return `${balls}-${strikes} | ${outs}`;
}

function buildInningIndicator(summary, selectedGame) {
  const situation = summary?.situation || null;
  const inningFromSituation = Number.isFinite(situation?.inning) ? Number(situation.inning) : null;
  const halfFromSituation = normalizeHalf(situation?.half);
  if (inningFromSituation !== null && halfFromSituation) {
    return `${halfFromSituation === "top" ? "▲" : "▼"} ${inningFromSituation}`;
  }

  const statusText = String(summary?.statusText || selectedGame?.statusText || "Pregame");
  const parsed = parseInningFromStatus(statusText);
  if (parsed) {
    return `${parsed.half === "top" ? "▲" : "▼"} ${parsed.inning}`;
  }

  return statusText;
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

function formatOuts(value) {
  if (!Number.isFinite(value)) {
    return "Outs ?";
  }
  return `${value} ${value === 1 ? "Out" : "Outs"}`;
}

function formatBaseState(bases) {
  if (!bases) {
    return "Unknown";
  }
  const occupied = [];
  if (bases.first) occupied.push("1B");
  if (bases.second) occupied.push("2B");
  if (bases.third) occupied.push("3B");
  return occupied.length ? occupied.join(", ") : "Empty";
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

function valueOrQuestion(value) {
  return Number.isFinite(value) ? String(value) : "?";
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function th(text) {
  const el = document.createElement("th");
  el.textContent = text;
  return el;
}

function td(text) {
  const el = document.createElement("td");
  el.textContent = text;
  return el;
}

function updateQueryString(gameId) {
  const url = new URL(window.location.href);
  if (gameId) {
    url.searchParams.set("id", String(gameId));
  } else {
    url.searchParams.delete("id");
  }
  window.history.replaceState({}, "", url);
}
