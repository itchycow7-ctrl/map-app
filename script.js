// iOSの虫眼鏡・長押しメニューを無効化
document.addEventListener('touchstart', function(e) {
  if (e.touches.length > 1) return; // ピンチズームは許可
}, { passive: false });

document.addEventListener('contextmenu', function(e) {
  e.preventDefault();
});

// Leaflet地図上での長押しデフォルト動作を無効化
const mapEl = document.getElementById('map');
if (mapEl) {
  mapEl.addEventListener('touchstart', function(e) {
    e.stopPropagation();
  }, { passive: true });

  mapEl.addEventListener('contextmenu', function(e) {
    e.preventDefault();
  });
}// 県名 → 都道府県コード（01〜47）

const prefCodeByName = {
  "北海道": "01",
  "青森県": "02",
  "岩手県": "03",
  "宮城県": "04",
  "秋田県": "05",
  "山形県": "06",
  "福島県": "07",
  "茨城県": "08",
  "栃木県": "09",
  "群馬県": "10",
  "埼玉県": "11",
  "千葉県": "12",
  "東京都": "13",
  "神奈川県": "14",
  "新潟県": "15",
  "富山県": "16",
  "石川県": "17",
  "福井県": "18",
  "山梨県": "19",
  "長野県": "20",
  "岐阜県": "21",
  "静岡県": "22",
  "愛知県": "23",
  "三重県": "24",
  "滋賀県": "25",
  "京都府": "26",
  "大阪府": "27",
  "兵庫県": "28",
  "奈良県": "29",
  "和歌山県": "30",
  "鳥取県": "31",
  "島根県": "32",
  "岡山県": "33",
  "広島県": "34",
  "山口県": "35",
  "徳島県": "36",
  "香川県": "37",
  "愛媛県": "38",
  "高知県": "39",
  "福岡県": "40",
  "佐賀県": "41",
  "長崎県": "42",
  "熊本県": "43",
  "大分県": "44",
  "宮崎県": "45",
  "鹿児島県": "46",
  "沖縄県": "47"
};

function getCityGeojsonPathByPrefName(prefName) {
  const code = prefCodeByName[prefName];
  if (!code) return null;
  return `geojson/municipality/${code}.json`;
}

const map = L.map("map", {
  attributionControl: false,
  tap: false,
  tapTolerance: 0,
  bounceAtZoomLimits: false
}).setView([36.2, 138.2], 5);

let prefData;
let currentLayer = null;

// hover用（1個だけ使い回し）
let hoverTooltip = null;

// visited: 市区町村コード配列（localStorage）
let visited = JSON.parse(localStorage.getItem("visitedCities") || "[]");

const backBtn = document.getElementById("backBtn");
const message = document.getElementById("message");
const progressEl = document.getElementById("progress");

// 県別リスト表示エリア（#progressの下）
const prefProgressListEl = document.getElementById("prefProgressList");
let prefListOpen = false;

// 「今表示している都道府県」
let currentPrefName = null;

// 「今の都道府県に含まれる市区町村コード一覧（Set）」
let currentPrefCityCodes = new Set();

// 全国（トップページ）進捗の分母（固定値）
const NATIONAL_MUNICIPALITIES = 1741;

// 県名 → その県に含まれる市区町村コードSet（県別GeoJSONから構築）
const prefCityCodesMap = new Map();

function normalizeCode(v) {
  return String(v ?? "").trim();
}

function getVisitedSet() {
  return new Set((visited || []).map(normalizeCode).filter(Boolean));
}

// FeatureCollection に正規化
function normalizeToFeatureCollection(gj) {
  if (!gj) return { type: "FeatureCollection", features: [] };
  if (gj.type === "FeatureCollection" && Array.isArray(gj.features)) return gj;
  if (gj.type === "Feature") return { type: "FeatureCollection", features: [gj] };
  if (Array.isArray(gj.features)) return { type: "FeatureCollection", features: gj.features };
  return { type: "FeatureCollection", features: [] };
}

// 市区町村名
function getCityName(feature) {
  const p = feature.properties || {};
  return p.N03_004 || p.N03_003 || p.city || p.name || "不明";
}

// 市区町村コード
function getCityCode(feature) {
  const p = feature.properties || {};
  return p.N03_007 ?? p.code ?? p.id ?? "";
}

function updateProgressView() {
  if (!progressEl) return;

  if (currentPrefName && currentPrefCityCodes.size > 0) {
    const visitedSet = getVisitedSet();
    let hit = 0;
    for (const code of currentPrefCityCodes) {
      if (visitedSet.has(normalizeCode(code))) hit++;
    }
    const total = currentPrefCityCodes.size;
    const pct = total ? (hit / total) * 100 : 0;
    progressEl.textContent = `${currentPrefName}\n${hit}/${total}（${pct.toFixed(1)}%）`;
    return;
  }

  const hit = getVisitedSet().size;
  const total = NATIONAL_MUNICIPALITIES;
  const pct = total ? (hit / total) * 100 : 0;
  progressEl.textContent = `全国\n${hit}/${total}（${pct.toFixed(1)}%）`;
}

async function buildPrefCityCodesMap() {
  const entries = Object.entries(prefCodeByName);

  await Promise.all(
    entries.map(async ([prefName, code]) => {
      const file = `geojson/municipality/${code}.json`;
      try {
        const r = await fetch(file);
        const data = await r.json();
        const fc = normalizeToFeatureCollection(data);

        const set = new Set(
          fc.features
            .map(f => normalizeCode(getCityCode(f)))
            .filter(Boolean)
        );

        prefCityCodesMap.set(prefName, set);
      } catch (e) {
        prefCityCodesMap.set(prefName, new Set());
      }
    })
  );
}

function getPrefVisitedRatio(prefName) {
  const citySet = prefCityCodesMap.get(prefName);
  if (!citySet || citySet.size === 0) return 0;

  const visitedSet = getVisitedSet();
  let hit = 0;
  for (const code of citySet) {
    if (visitedSet.has(normalizeCode(code))) hit++;
  }
  return hit / citySet.size;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function orangeGradient(t) {
  t = clamp01(t);
  const c0 = { r: 255, g: 242, b: 204 };
  const c1 = { r: 255, g: 106, b: 0 };
  const r = Math.round(lerp(c0.r, c1.r, t));
  const g = Math.round(lerp(c0.g, c1.g, t));
  const b = Math.round(lerp(c0.b, c1.b, t));
  return `rgb(${r}, ${g}, ${b})`;
}

function renderPrefProgressList() {
  if (!prefProgressListEl) return;

  if (!prefCityCodesMap || prefCityCodesMap.size === 0) {
    prefProgressListEl.innerHTML = "<div>集計中...</div>";
    return;
  }

  const visitedSet = getVisitedSet();

  const rows = Object.keys(prefCodeByName).map(prefName => {
    const citySet = prefCityCodesMap.get(prefName) || new Set();
    const total = citySet.size;
    let hit = 0;
    for (const code of citySet) {
      if (visitedSet.has(normalizeCode(code))) hit++;
    }
    const pct = total ? (hit / total) * 100 : 0;
    return { prefName, hit, total, pct };
  });

  rows.sort((a, b) => {
    const ca = Number(prefCodeByName[a.prefName] || 999);
    const cb = Number(prefCodeByName[b.prefName] || 999);
    return ca - cb;
  });

  prefProgressListEl.innerHTML = rows
    .map(r => `<div class="pref-row">${r.prefName}：${r.hit}/${r.total}（${r.pct.toFixed(1)}%）</div>`)
    .join("");
}

function openPrefProgressList() {
  if (!prefProgressListEl) return;
  prefListOpen = true;
  prefProgressListEl.style.display = "block";
  renderPrefProgressList();
}

function closePrefProgressList() {
  if (!prefProgressListEl) return;
  prefListOpen = false;
  prefProgressListEl.style.display = "none";
}

function togglePrefProgressList() {
  if (prefListOpen) closePrefProgressList();
  else openPrefProgressList();
}

fetch("https://raw.githubusercontent.com/dataofjapan/land/master/japan.geojson")
  .then(r => r.json())
  .then(async data => {
    prefData = data;
    await buildPrefCityCodesMap();
    drawPrefectures();
  })
  .catch(() => alert("都道府県GeoJSONが読み込めません"));

function drawPrefectures() {
  clearLayer();
  clearHoverTooltip();
  closePrefProgressList();
  if (backBtn) backBtn.style.display = "none";

  currentPrefName = null;
  currentPrefCityCodes = new Set();
  updateProgressView();

  currentLayer = L.geoJSON(prefData.features, {
    style: feature => {
      const prefName = feature.properties?.nam_ja || "不明";
      const ratio = getPrefVisitedRatio(prefName);
      const fill = orangeGradient(ratio);
      return {
        color: "#000",
        weight: 1,
        fillColor: fill,
        fillOpacity: 0.75
      };
    },

    onEachFeature: (feature, layer) => {
      const prefName = feature.properties?.nam_ja || "不明";

      layer.on("mouseover", e => {
        const ratio = getPrefVisitedRatio(prefName);
        showHoverTooltip(`${prefName}（${(ratio * 100).toFixed(1)}%）`, e.latlng);
        layer.setStyle({ weight: 2 });
      });

      layer.on("mouseout", () => {
        clearHoverTooltip();
        layer.setStyle({ weight: 1 });
      });

      layer.on("click", () => {
        const file = getCityGeojsonPathByPrefName(prefName);
        if (!file) {
          showMessage(`${prefName} はコード解決できません`);
          return;
        }
        loadCitiesGeojson(file, prefName);
      });

      let pressTimer = null;
      layer.on("mousedown touchstart", () => {
        pressTimer = setTimeout(() => {
          showMessage(prefName);
        }, 600);
      });
      layer.on("mouseup touchend touchcancel mouseleave", () => {
        clearTimeout(pressTimer);
        pressTimer = null;
      });
      layer.on("mousemove touchmove", () => {
        clearTimeout(pressTimer);
        pressTimer = null;
      });
    }
  }).addTo(map);

  map.fitBounds(currentLayer.getBounds());
}

function loadCitiesGeojson(file, prefName) {
  fetch(file)
    .then(r => r.json())
    .then(data => showCities(normalizeToFeatureCollection(data), prefName))
    .catch(() => alert(`${file} が読み込めません`));
}

function showCities(featureCollection, prefName) {
  clearLayer();
  clearHoverTooltip();
  closePrefProgressList();
  if (backBtn) backBtn.style.display = "block";

  currentPrefName = prefName || null;
  currentPrefCityCodes = new Set(
    featureCollection.features
      .map(f => normalizeCode(getCityCode(f)))
      .filter(Boolean)
  );

  updateProgressView();

  currentLayer = L.geoJSON(featureCollection, {
    style: feature => {
      const code = normalizeCode(getCityCode(feature));
      const visitedFlag = code && getVisitedSet().has(code);
      return {
        color: "#000",
        weight: 1,
        fillColor: visitedFlag ? "orange" : "#ffffff",
        fillOpacity: visitedFlag ? 0.7 : 0.15
      };
    },

    onEachFeature: (feature, layer) => {
      const name = getCityName(feature);
      const code = normalizeCode(getCityCode(feature));

      layer.on("mouseover", e => {
        showHoverTooltip(name, e.latlng);
        layer.setStyle({ weight: 2 });
      });

      layer.on("mousemove", e => {
        if (hoverTooltip) hoverTooltip.setLatLng(e.latlng);
      });

      layer.on("mouseout", () => {
        clearHoverTooltip();
        layer.setStyle({ weight: 1 });
      });

      layer.on("click", () => {
        if (!code) {
          showMessage("コードが取得できません");
          return;
        }

        toggleVisit(code);

        const visitedFlag = getVisitedSet().has(code);
        layer.setStyle({
          fillColor: visitedFlag ? "orange" : "#ffffff",
          fillOpacity: visitedFlag ? 0.7 : 0.15
        });

        updateProgressView();
        if (prefListOpen) renderPrefProgressList();
      });

      let pressTimer = null;
      layer.on("mousedown touchstart", () => {
        pressTimer = setTimeout(() => {
          showMessage(name);
        }, 600);
      });
      layer.on("mouseup touchend touchcancel mouseleave", () => {
        clearTimeout(pressTimer);
        pressTimer = null;
      });
      layer.on("mousemove touchmove", () => {
        clearTimeout(pressTimer);
        pressTimer = null;
      });
    }
  }).addTo(map);

  map.fitBounds(currentLayer.getBounds());
}

function showHoverTooltip(text, latlng) {
  if (!hoverTooltip) {
    hoverTooltip = L.tooltip({
      sticky: false,
      direction: "top",
      opacity: 0.9
    });
  }
  hoverTooltip.setContent(text);
  hoverTooltip.setLatLng(latlng);
  hoverTooltip.addTo(map);
}

function clearHoverTooltip() {
  if (hoverTooltip) {
    map.removeLayer(hoverTooltip);
  }
}

function toggleVisit(code) {
  const c = normalizeCode(code);
  if (!c) return;

  const visitedSet = getVisitedSet();
  if (visitedSet.has(c)) {
    visited = (visited || [])
      .map(normalizeCode)
      .filter(Boolean)
      .filter(v => v !== c);
  } else {
    visited = (visited || []).map(normalizeCode).filter(Boolean);
    visited.push(c);
    showMessage("ここに行ったことがある！");
  }
  localStorage.setItem("visitedCities", JSON.stringify(visited));
}

function showMessage(text) {
  if (!message) return;
  message.textContent = text;
  message.style.display = "block";
  setTimeout(() => (message.style.display = "none"), 1500);
}

function clearLayer() {
  if (currentLayer) map.removeLayer(currentLayer);
  currentLayer = null;
}

if (backBtn) backBtn.onclick = drawPrefectures;

if (progressEl) {
  progressEl.style.cursor = "pointer";
  progressEl.title = "押すと都道府県別の達成率リストを表示/非表示";
  progressEl.addEventListener("click", () => {
    togglePrefProgressList();
  });
}

updateProgressView();
