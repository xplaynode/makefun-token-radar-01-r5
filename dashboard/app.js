// Launch Radar dashboard: a static, offline view over window.RADAR (loaded
// from ../data.js). No fetch, no external assets. Views: the ranked board
// with search/filter, a per-protocol detail with an on-page recompute of
// the value from the row's own factors, the method panel, the products set
// aside, and the live tokens shown apart.
(function () {
  "use strict";
  var R = window.RADAR;
  if (!R) return;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(n) {
    if (n == null) return "—";
    if (Number.isInteger(n)) return "$" + n.toLocaleString("en-US");
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function mult(x) { return x == null ? "—" : "×" + Number(x).toFixed(4); }
  function pct(x) {
    if (x == null) return "—";
    var cls = x > 0 ? "up" : x < 0 ? "down" : "";
    return '<span class="' + cls + '">' + (x > 0 ? "+" : "") + x.toFixed(1) + "%</span>";
  }

  el("summary").textContent =
    R.protocols_scanned + " protocols scanned · " + R.board_size +
    " launch candidates ranked · " + R.products_size + " products set aside · " +
    R.live_size + " live tokens shown apart · snapshot as of " + R.as_of;
  el("foot").textContent = "Source: " + R.source + " · Model " + R.model_version +
    " · Watchlist floor " + money(R.floor_usd) + " · Fully offline; every figure is recomputed from the sealed snapshot.";

  var state = { view: "board", q: "", cat: "", watchOnly: false, detail: null };
  var params = new URLSearchParams(location.search);
  if (params.get("q")) state.q = params.get("q");
  if (params.get("cat")) state.cat = params.get("cat");
  if (params.get("watch") === "1") state.watchOnly = true;
  var hashMatch = location.hash.match(/detail=([A-Za-z0-9._-]+)/);
  if (hashMatch) state.detail = hashMatch[1];

  var catSel = el("cat");
  var cats = [];
  R.rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  cats.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  catSel.value = state.cat;
  el("q").value = state.q;
  el("watch-only").checked = state.watchOnly;

  function show(view) {
    state.view = view;
    ["board", "detail", "method", "products", "live"].forEach(function (v) {
      el("view-" + v).classList.toggle("hidden", v !== view);
    });
    var tabs = document.querySelectorAll("#tabs button");
    tabs.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === view ||
        (view === "detail" && b.getAttribute("data-view") === "board"));
    });
  }
  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () { show(b.getAttribute("data-view")); });
  });
  el("back").addEventListener("click", function () { show("board"); });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return R.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }

  function renderBoard() {
    var rows = filteredRows();
    el("shown").textContent = "Showing " + rows.length + " of " + R.rows.length + " candidates";
    var html = "";
    rows.forEach(function (r) {
      html += '<tr class="row" data-slug="' + esc(r.slug) + '">' +
        "<td>" + r.rank + "</td>" +
        '<td><span class="name">' + esc(r.name) + "</span>" +
        (r.watchlist ? ' <span class="star" title="On the watchlist">★</span>' : "") +
        '<br><span class="slug">' + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category) + "</td>" +
        '<td class="chains">' + esc(r.chains.join(", ")) + "</td>" +
        '<td class="num">' + money(r.tvl_usd) + "</td>" +
        '<td class="num">' + pct(r.change_7d) + "</td>" +
        '<td class="num">' + money(r.implied_value_usd) + "</td>" +
        '<td class="num"><span class="range">' + money(r.model.value_lo_usd) + " – " +
        money(r.model.value_hi_usd) + "</span></td>" +
        "<td>›</td></tr>";
    });
    var tbody = document.querySelector("#board-table tbody");
    tbody.innerHTML = html;
    tbody.querySelectorAll("tr.row").forEach(function (tr) {
      tr.addEventListener("click", function () { openDetail(tr.getAttribute("data-slug")); });
    });
  }
  el("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); });
  el("watch-only").addEventListener("change", function (e) { state.watchOnly = e.target.checked; renderBoard(); });

  function openDetail(slug) {
    var r = null;
    R.rows.forEach(function (row) { if (row.slug === slug) r = row; });
    if (!r) return;
    var m = r.model;
    var rest = m.momentum_factor * m.seasoning_factor * m.breadth_factor;
    var implied2 = Math.max(1, Math.round(r.tvl_usd * m.category_multiple * rest));
    var lo2 = Math.min(implied2, Math.max(1, Math.round(r.tvl_usd * m.range_lo_multiple * rest)));
    var hi2 = Math.max(implied2, Math.max(1, Math.round(r.tvl_usd * m.range_hi_multiple * rest)));
    var html = "";
    html += "<h2>#" + r.rank + " " + esc(r.name) +
      (r.watchlist ? ' <span class="star">★ watchlist</span>' : "") + "</h2>";
    html += '<p class="dim">' + esc(r.slug) + " · " + esc(r.category) + " · " +
      esc(r.chains.join(", ") || "no chains recorded") +
      (r.listed_at ? " · listed " + esc(r.listed_at) : " · listing date unknown") + "</p>";
    html += '<div class="kv">' +
      "<div><b>TVL</b><span>" + money(r.tvl_usd) + "</span></div>" +
      "<div><b>7d change</b><span>" + (r.change_7d == null ? "—" : r.change_7d.toFixed(2) + "%") + "</span></div>" +
      "<div><b>Age</b><span>" + (r.age_days == null ? "unknown (median used)" : r.age_days + " days") + "</span></div>" +
      "<div><b>Implied value</b><span>" + money(r.implied_value_usd) + "</span></div>" +
      "<div><b>Value range</b><span>" + money(m.value_lo_usd) + " – " + money(m.value_hi_usd) + "</span></div>" +
      "</div>";
    html += "<h3>Factor breakdown</h3>";
    html += '<p class="formula">implied = TVL × category multiple × momentum × seasoning × breadth<br>' +
      "= " + money(r.tvl_usd) + " × " + m.category_multiple + " × " + m.momentum_factor +
      " × " + m.seasoning_factor + " × " + m.breadth_factor + "</p>";
    html += '<div class="kv">' +
      "<div><b>Category multiple</b><span>" + mult(m.category_multiple) + "</span></div>" +
      "<div><b>Range multiples</b><span>" + mult(m.range_lo_multiple) + " – " + mult(m.range_hi_multiple) + "</span></div>" +
      "<div><b>Tokenised peers</b><span>" + m.multiple_peers + "</span></div>" +
      "<div><b>Momentum factor</b><span>" + m.momentum_factor + "</span></div>" +
      "<div><b>Seasoning factor</b><span>" + m.seasoning_factor + "</span></div>" +
      "<div><b>Breadth factor</b><span>" + m.breadth_factor + "</span></div>" +
      "</div>";
    html += '<p class="dim">Recomputed on this page from the rounded factors above: ' +
      money(implied2) + " (range " + money(lo2) + " – " + money(hi2) +
      "). Tiny differences from the headline come from the 4-decimal rounding of the printed factors.</p>";
    html += "<h3>Named peers behind the multiple</h3>";
    if (r.peers.length) {
      html += "<table><thead><tr><th>Peer</th><th class=\"num\">TVL</th><th class=\"num\">Market cap</th><th class=\"num\">mcap / TVL</th></tr></thead><tbody>";
      r.peers.forEach(function (p) {
        html += "<tr><td>" + esc(p.name) + ' <span class="slug">' + esc(p.slug) + "</span></td>" +
          '<td class="num">' + money(p.tvl_usd) + "</td>" +
          '<td class="num">' + money(p.mcap_usd) + "</td>" +
          '<td class="num">' + mult(p.ratio) + "</td></tr>";
      });
      html += "</tbody></table>";
    } else {
      html += '<p class="dim">This category has no tokenised peer in the snapshot; its multiple borrows the global median.</p>';
    }
    html += "<h3>Farm plan</h3>";
    html += '<div class="kv">' +
      "<div><b>Capital</b><span>" + money(r.plan.capital_usd) + "</span></div>" +
      "<div><b>Gas (midpoints)</b><span>" + money(r.plan.gas_usd) + "</span></div>" +
      "<div><b>Hold</b><span>" + r.plan.hold_days + " days (" + r.plan.weeks + " weeks)</span></div>" +
      "<div><b>Time</b><span>" + r.plan.minutes_total + " min total · " + r.plan.minutes_per_week + " min/week</span></div>" +
      "</div>";
    html += '<ol class="steps">';
    r.farm_steps.forEach(function (s) { html += "<li>" + esc(s) + "</li>"; });
    html += "</ol>";
    el("detail").innerHTML = html;
    show("detail");
  }

  function renderMethod() {
    var c = R.model;
    var html = '<div class="kv">' +
      "<div><b>Global median multiple</b><span>" + mult(R.global_multiple) + "</span></div>" +
      "<div><b>Global Q1 / Q3</b><span>" + mult(R.global_q1) + " / " + mult(R.global_q3) + "</span></div>" +
      "<div><b>Median pre-token age</b><span>" + R.median_age_days + " days</span></div>" +
      "<div><b>Shrinkage K</b><span>" + c.shrink_k + " pseudo-peers</span></div>" +
      "<div><b>Thin-peer pull</b><span>" + c.thin_peer_pull + " below " + c.thin_peer_threshold + " peers</span></div>" +
      "<div><b>Multiple band</b><span>×" + c.multiple_lo + " – ×" + c.multiple_hi + "</span></div>" +
      "<div><b>Momentum</b><span>weight " + c.momentum_weight + ", 7d change clamped " +
      c.momentum_floor_pct + "%…+" + c.momentum_cap_pct + "%</span></div>" +
      "<div><b>Seasoning</b><span>" + c.seasoning_base + " + " + c.seasoning_range +
      " over " + c.seasoning_days + " days</span></div>" +
      "<div><b>Breadth</b><span>+" + (c.breadth_per_chain * 100) + "% per extra chain, max " +
      c.breadth_max_extra_chains + "</span></div>" +
      "</div>";
    html += "<h3>Category multiples</h3>";
    html += "<table><thead><tr><th>Category</th><th class=\"num\">Peers</th><th class=\"num\">Peer median</th>" +
      "<th class=\"num\">Peer Q1</th><th class=\"num\">Peer Q3</th><th class=\"num\">Used</th><th class=\"num\">Range</th></tr></thead><tbody>";
    R.multiples.forEach(function (t) {
      html += "<tr><td>" + esc(t.category) + "</td>" +
        '<td class="num">' + t.peers + "</td>" +
        '<td class="num">' + mult(t.peer_median) + "</td>" +
        '<td class="num">' + mult(t.peer_q1) + "</td>" +
        '<td class="num">' + mult(t.peer_q3) + "</td>" +
        '<td class="num">' + mult(t.multiple) + "</td>" +
        '<td class="num">' + mult(t.range_lo_multiple) + " – " + mult(t.range_hi_multiple) + "</td></tr>";
    });
    html += "</tbody></table>";
    el("method-body").innerHTML = html;
  }

  function renderProducts() {
    var html = "";
    R.products.forEach(function (p) {
      html += "<tr><td><span class=\"name\">" + esc(p.name) + "</span><br><span class=\"slug\">" +
        esc(p.slug) + "</span></td><td>" + esc(p.category) + "</td>" +
        '<td class="chains">' + esc(p.chains.join(", ")) + "</td>" +
        '<td class="num">' + money(p.tvl_usd) + "</td><td>" + esc(p.reason) + "</td></tr>";
    });
    document.querySelector("#products-table tbody").innerHTML = html;
  }

  function renderLive() {
    var html = "";
    R.live.forEach(function (p) {
      html += "<tr><td><span class=\"name\">" + esc(p.name) + "</span><br><span class=\"slug\">" +
        esc(p.slug) + "</span></td><td>" + esc(p.symbol || "—") + "</td><td>" + esc(p.category) + "</td>" +
        '<td class="num">' + money(p.tvl_usd) + "</td>" +
        '<td class="num">' + money(p.mcap_usd) + "</td>" +
        '<td class="num">' + mult(p.multiple) + "</td></tr>";
    });
    document.querySelector("#live-table tbody").innerHTML = html;
  }

  renderBoard();
  renderMethod();
  renderProducts();
  renderLive();
  if (state.detail) openDetail(state.detail);
})();
