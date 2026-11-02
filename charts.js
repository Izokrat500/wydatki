// --- Zakładka Wykresy: rysowane w SVG, bez bibliotek, więc działają też bez internetu ---

const CHART_MONTHS_BACK = 6;
const CHART_TOP_CATEGORIES = 5;
const CHART_HEIGHT = 190;
const SVG_NS = "http://www.w3.org/2000/svg";

let chartsMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

function svgElement(tag, attributes, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  if (parent) parent.append(el);
  return el;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isCurrentMonth(date) {
  return monthKey(date) === monthKey(new Date());
}

function transactionsInMonth(kind, key) {
  return ledger(kind).transactions.filter((t) => t.date.startsWith(key));
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Czytelne wartości osi: 100, 250, 500, 1000...
function niceMax(value) {
  if (value <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value);
  return step * power;
}

function formatTick(value) {
  if (value < 1000) return String(value);
  return `${String(value / 1000).replace(".", ",")} tys.`;
}

function signedMoney(grosze) {
  const sign = grosze > 0 ? "+" : grosze < 0 ? "−" : "";
  return sign + formatMoney(Math.abs(grosze));
}

function plotArea(containerId, padding) {
  const container = $(containerId);
  container.replaceChildren();
  const width = container.clientWidth;
  const svg = svgElement("svg", {
    width,
    height: CHART_HEIGHT,
    viewBox: `0 0 ${width} ${CHART_HEIGHT}`,
    class: "chart-svg",
  }, container);
  return {
    svg,
    width,
    left: padding.left,
    right: width - padding.right,
    top: padding.top,
    bottom: CHART_HEIGHT - padding.bottom,
  };
}

// Trzy cienkie linie siatki z podpisami; wartości w złotych.
function drawGrid(plot, maxValue) {
  const y = (value) => plot.bottom - (value / maxValue) * (plot.bottom - plot.top);
  for (const value of [0, maxValue / 2, maxValue]) {
    svgElement("line", {
      x1: plot.left, x2: plot.right, y1: y(value), y2: y(value), class: "chart-grid",
    }, plot.svg);
    const label = svgElement("text", {
      x: plot.left - 6, y: y(value) + 4, "text-anchor": "end", class: "chart-tick",
    }, plot.svg);
    label.textContent = formatTick(value);
  }
  return y;
}

function renderLegend(id, items) {
  const box = $(id);
  box.replaceChildren();
  for (const { label, className } of items) {
    const row = element("span", "legend-item");
    row.append(element("span", `legend-key ${className}`), element("span", "", label));
    box.append(row);
  }
}

function renderChartTable(id, headers, rows) {
  const table = element("table", "chart-table");
  const head = element("tr");
  for (const header of headers) head.append(element("th", "", header));
  table.append(head);
  for (const cells of rows) {
    const row = element("tr");
    for (const cell of cells) row.append(element("td", "", cell));
    table.append(row);
  }
  $(id).replaceChildren(table);
}

// --- Dymek z wartościami: najpierw liczba, potem nazwa ---

function showChartTooltip(title, rows, clientX, clientY) {
  const tooltip = $("chart-tooltip");
  tooltip.replaceChildren(element("div", "tooltip-title", title));
  for (const { value, label, className } of rows) {
    const row = element("div", "tooltip-row");
    row.append(
      element("span", `tooltip-key ${className || ""}`),
      element("strong", "", value),
      element("span", "tooltip-label", label),
    );
    tooltip.append(row);
  }
  tooltip.hidden = false;
  const box = tooltip.getBoundingClientRect();
  const margin = 8;
  const left = Math.min(window.innerWidth - box.width - margin, Math.max(margin, clientX - box.width / 2));
  const above = clientY - box.height - 14;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${above > margin ? above : clientY + 18}px`;
}

function hideChartTooltip() {
  $("chart-tooltip").hidden = true;
}

// --- Wykres 1: wpływy i wydatki z ostatnich miesięcy ---

function renderFlowChart() {
  const months = [];
  for (let i = CHART_MONTHS_BACK - 1; i >= 0; i--) {
    const date = addMonths(chartsMonth, -i);
    const key = monthKey(date);
    months.push({
      date,
      income: sumOf(transactionsInMonth("income", key)),
      expense: sumOf(transactionsInMonth("expense", key)),
    });
  }

  const totalIncome = months.reduce((sum, m) => sum + m.income, 0);
  const totalExpense = months.reduce((sum, m) => sum + m.expense, 0);
  const hasData = totalIncome + totalExpense > 0;
  $("flow-headline").textContent = hasData
    ? `Bilans z ${CHART_MONTHS_BACK} miesięcy: ${signedMoney(totalIncome - totalExpense)}`
    : "Dodaj wpływy i wydatki, a pojawi się tu ich porównanie";
  $("flow-legend").hidden = !hasData;
  $("flow-details").hidden = !hasData;
  if (!hasData) {
    $("flow-chart").replaceChildren();
    return;
  }

  renderLegend("flow-legend", [
    { label: "Wpływy", className: "key-income" },
    { label: "Wydatki", className: "key-expense" },
  ]);

  const plot = plotArea("flow-chart", { left: 46, right: 2, top: 10, bottom: 24 });
  const largest = Math.max(...months.map((m) => Math.max(m.income, m.expense))) / 100;
  const maxValue = niceMax(largest);
  const y = drawGrid(plot, maxValue);
  const band = (plot.right - plot.left) / months.length;
  const barWidth = Math.min(16, (band - 14) / 2);

  months.forEach((month, index) => {
    const center = plot.left + band * (index + 0.5);
    const group = svgElement("g", { class: "chart-band" }, plot.svg);
    svgElement("rect", {
      x: plot.left + band * index + 2,
      y: plot.top - 6,
      width: band - 4,
      height: plot.bottom - plot.top + 6,
      rx: 8,
      class: "chart-band-highlight",
    }, group);

    drawColumn(group, center - barWidth - 1, barWidth, month.income / 100, y, plot.bottom, "bar-income");
    drawColumn(group, center + 1, barWidth, month.expense / 100, y, plot.bottom, "bar-expense");

    const selected = index === months.length - 1;
    const label = svgElement("text", {
      x: center,
      y: CHART_HEIGHT - 7,
      "text-anchor": "middle",
      class: selected ? "chart-tick chart-tick-strong" : "chart-tick",
    }, group);
    label.textContent = MONTHS_SHORT[month.date.getMonth()];

    const title = `${MONTHS[month.date.getMonth()]} ${month.date.getFullYear()}`;
    const rows = [
      { value: formatMoney(month.income), label: "wpływy", className: "key-income" },
      { value: formatMoney(month.expense), label: "wydatki", className: "key-expense" },
      { value: signedMoney(month.income - month.expense), label: "bilans" },
    ];
    // Cały pas miesiąca reaguje na palec, nie tylko wąski słupek.
    const hit = svgElement("rect", {
      x: plot.left + band * index,
      y: 0,
      width: band,
      height: CHART_HEIGHT,
      class: "chart-hit",
      tabindex: 0,
      role: "img",
      "data-chart-hit": "true",
      "aria-label": `${title}: wpływy ${formatMoney(month.income)}, wydatki ${formatMoney(month.expense)}`,
    }, group);
    const show = (event) => {
      showChartTooltip(title, rows, event.clientX, event.clientY);
    };
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") hideChartTooltip();
    });
    hit.addEventListener("focus", () => {
      const box = hit.getBoundingClientRect();
      showChartTooltip(title, rows, box.left + box.width / 2, box.top + 20);
    });
    hit.addEventListener("blur", hideChartTooltip);
  });

  renderChartTable("flow-table", ["Miesiąc", "Wpływy", "Wydatki", "Bilans"], months.map((m) => [
    `${MONTHS_SHORT[m.date.getMonth()]} ${m.date.getFullYear()}`,
    formatNumber(m.income),
    formatNumber(m.expense),
    signedMoney(m.income - m.expense).replace(" PLN", ""),
  ]));
}

// Słupek z zaokrągloną górą, prosty przy podstawie.
function drawColumn(parent, x, width, value, y, baseline, className) {
  if (value <= 0) return;
  const top = Math.min(y(value), baseline - 2);
  const radius = Math.min(4, width / 2, baseline - top);
  const d = `M${x} ${baseline}V${top + radius}Q${x} ${top} ${x + radius} ${top}`
    + `H${x + width - radius}Q${x + width} ${top} ${x + width} ${top + radius}V${baseline}Z`;
  svgElement("path", { d, class: `chart-bar ${className}` }, parent);
}

// --- Wykres 2: tempo wydawania w miesiącu na tle poprzedniego ---

function cumulativeByDay(date, lastDay) {
  const totals = new Array(lastDay + 1).fill(0);
  for (const transaction of transactionsInMonth("expense", monthKey(date))) {
    const day = Number(transaction.date.slice(8, 10));
    if (day <= lastDay) totals[day] += transaction.grosze;
  }
  for (let day = 1; day <= lastDay; day++) totals[day] += totals[day - 1];
  return totals;
}

function paceHeadline(current, previous, ongoing) {
  const verb = ongoing ? "są" : "były";
  const when = ongoing ? "niż o tej porze miesiąc temu" : "niż miesiąc wcześniej";
  if (previous === 0) return `${ongoing ? "Do dziś wydano" : "W tym miesiącu wydano"} ${formatMoney(current)}`;
  if (current === previous) return `Wydatki ${verb} takie same ${when}`;
  if (current >= previous * 2) {
    const times = String(Math.round((current / previous) * 10) / 10).replace(".", ",");
    return `Wydatki ${verb} ${times} razy wyższe ${when}`;
  }
  const percent = Math.max(1, Math.round((Math.abs(current - previous) / previous) * 100));
  return `Wydatki ${verb} o ${percent}% ${current < previous ? "niższe" : "wyższe"} ${when}`;
}

function renderPaceChart() {
  const previousMonth = addMonths(chartsMonth, -1);
  const ongoing = isCurrentMonth(chartsMonth);
  const lastDay = ongoing ? new Date().getDate() : daysInMonth(chartsMonth);
  const previousLastDay = daysInMonth(previousMonth);
  const current = cumulativeByDay(chartsMonth, lastDay);
  const previous = cumulativeByDay(previousMonth, previousLastDay);
  const hasData = current[lastDay] + previous[previousLastDay] > 0;

  $("pace-headline").textContent = hasData
    ? paceHeadline(current[lastDay], previous[Math.min(lastDay, previousLastDay)], ongoing)
    : "Brak wydatków w tym i poprzednim miesiącu";
  $("pace-legend").hidden = !hasData;
  $("pace-details").hidden = !hasData;
  if (!hasData) {
    $("pace-chart").replaceChildren();
    return;
  }

  const currentName = MONTHS[chartsMonth.getMonth()];
  const previousName = MONTHS[previousMonth.getMonth()];
  renderLegend("pace-legend", [
    { label: currentName, className: "key-line-expense" },
    { label: previousName, className: "key-line-muted" },
  ]);

  const plot = plotArea("pace-chart", { left: 46, right: 10, top: 12, bottom: 24 });
  const maxValue = niceMax(Math.max(current[lastDay], previous[previousLastDay]) / 100);
  const y = drawGrid(plot, maxValue);
  const lastX = Math.max(daysInMonth(chartsMonth), previousLastDay);
  const x = (day) => plot.left + ((day - 1) / (lastX - 1)) * (plot.right - plot.left);

  const linePath = (values, end) => {
    let d = "";
    for (let day = 1; day <= end; day++) d += `${day === 1 ? "M" : "L"}${x(day)} ${y(values[day] / 100)}`;
    return d;
  };

  // Delikatna plazmowa poświata pod linią bieżącego miesiąca.
  const defs = svgElement("defs", {}, plot.svg);
  const gradient = svgElement("linearGradient", { id: "pace-wash", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgElement("stop", { offset: "0%", "stop-color": "var(--chart-expense)", "stop-opacity": 0.28 }, gradient);
  svgElement("stop", { offset: "100%", "stop-color": "var(--chart-expense)", "stop-opacity": 0 }, gradient);

  svgElement("path", { d: linePath(previous, previousLastDay), class: "chart-line chart-line-muted" }, plot.svg);
  svgElement("path", {
    d: `${linePath(current, lastDay)}L${x(lastDay)} ${plot.bottom}L${x(1)} ${plot.bottom}Z`,
    fill: "url(#pace-wash)",
    class: "chart-wash",
  }, plot.svg);
  svgElement("path", { d: linePath(current, lastDay), class: "chart-line chart-line-expense" }, plot.svg);
  svgElement("circle", {
    cx: x(lastDay), cy: y(current[lastDay] / 100), r: 5, class: "chart-end-dot",
  }, plot.svg);

  for (const day of [1, 10, 20, lastX]) {
    const label = svgElement("text", {
      x: x(day), y: CHART_HEIGHT - 7, "text-anchor": day === 1 ? "start" : day === lastX ? "end" : "middle", class: "chart-tick",
    }, plot.svg);
    label.textContent = String(day);
  }

  // Pionowa linia podąża za palcem i pokazuje wartości obu miesięcy tego samego dnia.
  const crosshair = svgElement("line", {
    y1: plot.top, y2: plot.bottom, class: "chart-crosshair", visibility: "hidden",
  }, plot.svg);
  const markerPrevious = svgElement("circle", { r: 4, class: "chart-marker-muted", visibility: "hidden" }, plot.svg);
  const markerCurrent = svgElement("circle", { r: 4, class: "chart-marker-expense", visibility: "hidden" }, plot.svg);

  const hit = svgElement("rect", {
    x: plot.left,
    y: 0,
    width: plot.right - plot.left,
    height: CHART_HEIGHT,
    class: "chart-hit chart-hit-scrub",
    tabindex: 0,
    role: "img",
    "data-chart-hit": "true",
    "aria-label": `${$("pace-headline").textContent}. Strzałki w lewo i w prawo zmieniają dzień.`,
  }, plot.svg);

  let focusedDay = lastDay;
  const showDay = (day, clientX, clientY) => {
    focusedDay = day;
    const rows = [];
    crosshair.setAttribute("x1", x(day));
    crosshair.setAttribute("x2", x(day));
    crosshair.setAttribute("visibility", "visible");
    if (day <= lastDay) {
      markerCurrent.setAttribute("cx", x(day));
      markerCurrent.setAttribute("cy", y(current[day] / 100));
      markerCurrent.setAttribute("visibility", "visible");
      rows.push({ value: formatMoney(current[day]), label: currentName.toLowerCase(), className: "key-line-expense" });
    } else {
      markerCurrent.setAttribute("visibility", "hidden");
    }
    if (day <= previousLastDay) {
      markerPrevious.setAttribute("cx", x(day));
      markerPrevious.setAttribute("cy", y(previous[day] / 100));
      markerPrevious.setAttribute("visibility", "visible");
      rows.push({ value: formatMoney(previous[day]), label: previousName.toLowerCase(), className: "key-line-muted" });
    } else {
      markerPrevious.setAttribute("visibility", "hidden");
    }
    showChartTooltip(`Do ${day}. dnia miesiąca`, rows, clientX, clientY);
  };
  const clearDay = () => {
    for (const mark of [crosshair, markerCurrent, markerPrevious]) mark.setAttribute("visibility", "hidden");
    hideChartTooltip();
  };
  const dayFromEvent = (event) => {
    const box = plot.svg.getBoundingClientRect();
    const ratio = (event.clientX - box.left - plot.left) / (plot.right - plot.left);
    return Math.max(1, Math.min(lastX, Math.round(ratio * (lastX - 1)) + 1));
  };
  const onPointer = (event) => showDay(dayFromEvent(event), event.clientX, event.clientY);
  hit.addEventListener("pointerdown", onPointer);
  hit.addEventListener("pointermove", onPointer);
  hit.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") clearDay();
  });
  const showFocused = () => {
    const box = plot.svg.getBoundingClientRect();
    showDay(focusedDay, box.left + x(focusedDay), box.top + 30);
  };
  hit.addEventListener("focus", showFocused);
  hit.addEventListener("blur", clearDay);
  hit.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    focusedDay = Math.max(1, Math.min(lastX, focusedDay + (event.key === "ArrowLeft" ? -1 : 1)));
    showFocused();
  });
  paceClear = clearDay;

  const days = [];
  for (let day = 5; day < lastX; day += 5) days.push(day);
  days.push(lastX);
  renderChartTable("pace-table", ["Do dnia", currentName, previousName], days.map((day) => [
    String(day),
    day <= lastDay ? formatNumber(current[day]) : "–",
    day <= previousLastDay ? formatNumber(previous[day]) : "–",
  ]));
}

let paceClear = null;

// --- Wykres 3: na co idą pieniądze ---

function renderWhereChart() {
  const transactions = transactionsInMonth("expense", monthKey(chartsMonth));
  const total = sumOf(transactions);
  const box = $("where-chart");
  box.replaceChildren();

  if (total === 0) {
    $("where-headline").textContent = "Brak wydatków w tym miesiącu";
    return;
  }

  const totals = new Map();
  for (const transaction of transactions) {
    totals.set(transaction.category, (totals.get(transaction.category) || 0) + transaction.grosze);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, CHART_TOP_CATEGORIES);
  const rest = ranked.slice(CHART_TOP_CATEGORIES).reduce((sum, [, value]) => sum + value, 0);

  const share = (value) => Math.round((value / total) * 100);
  $("where-headline").textContent = `Najwięcej idzie na: ${top[0][0]} (${share(top[0][1])}%)`;

  const addRow = (name, value, isRest) => {
    const row = element("div", "where-row");
    const head = element("div", "where-head");
    if (isRest) head.append(element("span", "avatar", "…"));
    else head.append(avatar(name));
    const percent = element("span", "where-percent", `${share(value)}%`);
    head.append(element("span", "where-name", name), percent, element("span", "where-value", formatMoney(value)));
    const track = element("div", "where-track");
    const fill = element("span", isRest ? "where-fill where-fill-rest" : "where-fill");
    fill.style.width = `${Math.max(1, (value / total) * 100)}%`;
    track.append(fill);
    row.append(head, track);
    box.append(row);
  };
  for (const [name, value] of top) addRow(name, value, false);
  if (rest > 0) addRow("Pozostałe", rest, true);
}

// --- Całość zakładki ---

function renderCharts() {
  hideChartTooltip();
  $("charts-title").textContent = `${MONTHS[chartsMonth.getMonth()]} ${chartsMonth.getFullYear()}`;
  $("charts-next").disabled = isCurrentMonth(chartsMonth);
  renderFlowChart();
  renderPaceChart();
  renderWhereChart();
}

function chartsTabVisible() {
  return !$("tab-wykresy").hidden;
}

$("charts-prev").addEventListener("click", () => {
  chartsMonth = addMonths(chartsMonth, -1);
  renderCharts();
});
$("charts-next").addEventListener("click", () => {
  if (isCurrentMonth(chartsMonth)) return;
  chartsMonth = addMonths(chartsMonth, 1);
  renderCharts();
});
// Stuknięcie poza wykresem albo przewinięcie chowa dymek.
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest && event.target.closest("[data-chart-hit]")) return;
  if (paceClear) paceClear();
  hideChartTooltip();
});
window.addEventListener("scroll", () => {
  if (paceClear) paceClear();
  hideChartTooltip();
}, { passive: true });
window.addEventListener("resize", () => {
  if (chartsTabVisible()) renderCharts();
});
