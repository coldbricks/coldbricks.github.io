(function () {
  "use strict";

  var PERIOD_MS = 8000;
  var TAU = Math.PI * 2;
  var MAX_DPR = 2;
  var states = new Set();
  var stateByCanvas = new WeakMap();
  var frameRequest = 0;
  var intersectionObserver = null;
  var resizeObserver = null;
  var motionQuery = null;
  var reduceMotion = false;

  function cssVariable(styles, name, fallback) {
    var value = styles.getPropertyValue(name).trim();
    return value || fallback;
  }

  function readTheme() {
    var styles = window.getComputedStyle(document.documentElement);
    return {
      deep: cssVariable(styles, "--ink-deep", "#08040C"),
      ink: cssVariable(styles, "--ink", "#0A0610"),
      raised: cssVariable(styles, "--ink-raise", "#120A1E"),
      card: cssVariable(styles, "--ink-card", "#150B22"),
      line: cssVariable(styles, "--line", "#2A1838"),
      accent: cssVariable(styles, "--pink", "#FF48AD"),
      accentSoft: cssVariable(styles, "--pink-soft", "#FF8DC7"),
      teal: cssVariable(styles, "--teal", "#2EE6C5"),
      tealPale: cssVariable(styles, "--teal-pale", "#B6FFFB"),
      green: cssVariable(styles, "--green", "#7CFFB2"),
      amber: cssVariable(styles, "--theory-amber", "#FFB84D"),
      body: cssVariable(styles, "--body", "#EFE6F0"),
      dim: cssVariable(styles, "--dim", "#9A7A8C"),
      muted: cssVariable(styles, "--mut", "#C9B8CC")
    };
  }

  function withAlpha(ctx, alpha, draw) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    draw();
    ctx.restore();
  }

  function roundedPath(ctx, x, y, width, height, radius) {
    var r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function fillRoundRect(ctx, x, y, width, height, radius, color, alpha) {
    ctx.save();
    ctx.fillStyle = color;
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    roundedPath(ctx, x, y, width, height, radius);
    ctx.fill();
    ctx.restore();
  }

  function strokeRoundRect(ctx, x, y, width, height, radius, color, lineWidth, alpha) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    roundedPath(ctx, x, y, width, height, radius);
    ctx.stroke();
    ctx.restore();
  }

  function line(ctx, x0, y0, x1, y1, color, lineWidth, alpha) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth || 2;
    ctx.lineCap = "round";
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.restore();
  }

  function circle(ctx, x, y, radius, color, fill, lineWidth, alpha) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth || 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function ellipse(ctx, x, y, radiusX, radiusY, color, fill, lineWidth, alpha, rotation) {
    ctx.save();
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, radiusX), Math.max(0.1, radiusY), rotation || 0, 0, TAU);
    if (fill) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth || 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function arrow(ctx, x0, y0, x1, y1, color, lineWidth, headLength, alpha) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var length = Math.max(1, Math.hypot(dx, dy));
    var ux = dx / length;
    var uy = dy / length;
    var head = headLength || 11;
    var wing = head * 0.54;
    line(ctx, x0, y0, x1, y1, color, lineWidth || 2.5, alpha);
    ctx.save();
    ctx.fillStyle = color;
    if (alpha !== undefined) ctx.globalAlpha *= alpha;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * wing, y1 - uy * head + ux * wing);
    ctx.lineTo(x1 - ux * head + uy * wing, y1 - uy * head - ux * wing);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function setFont(ctx, size, weight, mono) {
    var family = mono
      ? 'Consolas, "Cascadia Code", "SFMono-Regular", Menlo, monospace'
      : '"Segoe UI", Roboto, system-ui, sans-serif';
    ctx.font = (weight || 500) + " " + size + "px " + family;
  }

  function ellipsize(ctx, value, maxWidth) {
    var text = String(value);
    if (!maxWidth || ctx.measureText(text).width <= maxWidth) return text;
    var suffix = "…";
    var low = 0;
    var high = text.length;
    while (low < high) {
      var mid = Math.ceil((low + high) / 2);
      if (ctx.measureText(text.slice(0, mid) + suffix).width <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return text.slice(0, low) + suffix;
  }

  function text(ctx, value, x, y, size, color, options) {
    var opts = options || {};
    ctx.save();
    setFont(ctx, size, opts.weight || 500, !!opts.mono);
    ctx.fillStyle = color;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    var output = ellipsize(ctx, value, opts.maxWidth);
    ctx.fillText(output, x, y);
    ctx.restore();
    return output;
  }

  function panel(ctx, x, y, width, height, theme, edge, alpha) {
    fillRoundRect(ctx, x, y, width, height, 14, theme.deep, alpha === undefined ? 0.72 : alpha);
    strokeRoundRect(ctx, x, y, width, height, 14, edge || theme.teal, 1.7, 0.38);
  }

  function backdrop(ctx, width, height, theme, deeper) {
    var gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, theme.raised);
    gradient.addColorStop(0.52, theme.ink);
    gradient.addColorStop(1, deeper ? theme.raised : theme.deep);
    ctx.save();
    ctx.globalAlpha = 0.76;
    ctx.fillStyle = gradient;
    roundedPath(ctx, 1, 1, width - 2, height - 2, 15);
    ctx.fill();
    ctx.restore();

    var glow = ctx.createRadialGradient(width * 0.52, height * 0.35, 0, width * 0.52, height * 0.35, width * 0.52);
    glow.addColorStop(0, deeper ? theme.green : theme.teal);
    glow.addColorStop(1, theme.deep);
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.fillStyle = glow;
    roundedPath(ctx, 2, 2, width - 4, height - 4, 14);
    ctx.fill();
    ctx.restore();
    strokeRoundRect(ctx, 1.5, 1.5, width - 3, height - 3, 14, deeper ? theme.green : theme.teal, 1.5, 0.28);
  }

  function renderOverview(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var labels = ["FILE", "DETECT", "DECODE", "PROJECT", "EYES"];
    var start = 68;
    var step = (width - start * 2) / (labels.length - 1);
    var cy = height * 0.44;
    for (var i = 0; i < labels.length; i += 1) {
      var x = start + step * i;
      var pulse = 0.5 + 0.5 * Math.sin(phase * TAU + i * 0.9);
      if (i < labels.length - 1) arrow(ctx, x + 23, cy, x + step - 23, cy, theme.teal, 2, 9, 0.36);
      circle(ctx, x, cy, 16 + pulse * 3, theme.accent, false, 3, 0.9);
      circle(ctx, x, cy, 5, theme.accent, true, 0, 0.95);
      text(ctx, labels[i], x, cy + 45, 18, theme.tealPale, { align: "center", mono: true, weight: 700 });
    }
    text(ctx, "local signal path — no cloud hop", 30, height - 20, 17, theme.muted, { mono: true, weight: 600 });
  }

  function drawAirplane(ctx, cx, cy, scale, color, mode, phase, theme) {
    var wave = Math.sin(phase * TAU);
    var s = scale;
    var edgeWidth = Math.max(2, 1.8 * s);

    function finishPath() {
      ctx.fillStyle = theme.deep;
      ctx.globalAlpha = 0.96;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = edgeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(wave * (mode === "pitch" ? 18 : mode === "roll" ? 24 : 22) * Math.PI / 180);

    if (mode === "pitch") {
      ctx.beginPath();
      ctx.moveTo(34 * s, 1 * s);
      ctx.bezierCurveTo(30 * s, -5.5 * s, 18 * s, -7 * s, 6 * s, -6.5 * s);
      ctx.lineTo(-18 * s, -5.5 * s);
      ctx.bezierCurveTo(-24 * s, -5 * s, -28 * s, -2 * s, -30 * s, 1 * s);
      ctx.bezierCurveTo(-28 * s, 4 * s, -24 * s, 5.5 * s, -18 * s, 5.5 * s);
      ctx.lineTo(6 * s, 6.5 * s);
      ctx.bezierCurveTo(18 * s, 7 * s, 30 * s, 5.5 * s, 34 * s, 1 * s);
      ctx.closePath();
      finishPath();

      ctx.save();
      ctx.fillStyle = theme.body;
      ctx.globalAlpha = 0.48;
      for (var wi = 0; wi <= 5; wi += 1) {
        ctx.beginPath();
        ctx.arc((-8 + wi * 4.2) * s, -2.2 * s, 1.05 * s, 0, TAU);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.ellipse(23 * s, -3.35 * s, 5 * s, 2.15 * s, -0.08, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.beginPath();
      ctx.moveTo(-2 * s, 2 * s);
      ctx.lineTo(12 * s, 2.5 * s);
      ctx.lineTo(8 * s, 12 * s);
      ctx.lineTo(-6 * s, 11 * s);
      ctx.closePath();
      finishPath();

      fillRoundRect(ctx, 0, 7 * s, 10 * s, 5.5 * s, 3 * s, theme.deep, 0.96);
      strokeRoundRect(ctx, 0, 7 * s, 10 * s, 5.5 * s, 3 * s, color, edgeWidth, 1);

      ctx.beginPath();
      ctx.moveTo(-18 * s, -4.2 * s);
      ctx.lineTo(-27 * s, -17 * s);
      ctx.lineTo(-31 * s, -15.5 * s);
      ctx.lineTo(-28 * s, -3.2 * s);
      ctx.closePath();
      finishPath();

      ctx.beginPath();
      ctx.moveTo(-32 * s, 0.4 * s);
      ctx.lineTo(-20 * s, -0.3 * s);
      ctx.lineTo(-20 * s, 2.4 * s);
      ctx.lineTo(-32 * s, 2.9 * s);
      ctx.closePath();
      finishPath();

      line(ctx, 8 * s, 6.5 * s, 8 * s, 13 * s, color, edgeWidth * 0.72);
      circle(ctx, 8 * s, 13.5 * s, 1.7 * s, color, false, edgeWidth * 0.72);
    } else if (mode === "roll") {
      ctx.beginPath();
      ctx.moveTo(-38 * s, -1 * s);
      ctx.lineTo(-36 * s, 3.5 * s);
      ctx.lineTo(-8 * s, 5 * s);
      ctx.lineTo(8 * s, 5 * s);
      ctx.lineTo(36 * s, 3.5 * s);
      ctx.lineTo(38 * s, -1 * s);
      ctx.lineTo(10 * s, -3.5 * s);
      ctx.lineTo(-10 * s, -3.5 * s);
      ctx.closePath();
      finishPath();

      ellipse(ctx, 0, 1 * s, 7.5 * s, 9 * s, theme.deep, true, 0, 0.96);
      ellipse(ctx, 0, 1 * s, 7.5 * s, 9 * s, color, false, edgeWidth);
      withAlpha(ctx, 0.48, function () {
        ellipse(ctx, 0, -3 * s, 5.4 * s, 3.8 * s, theme.body, true);
      });

      ctx.beginPath();
      ctx.moveTo(-2 * s, -7 * s);
      ctx.lineTo(0, -22 * s);
      ctx.lineTo(2 * s, -7 * s);
      ctx.closePath();
      finishPath();
      line(ctx, -11 * s, -8 * s, 11 * s, -8 * s, color, edgeWidth);
      ellipse(ctx, -17 * s, 6 * s, 5 * s, 3 * s, theme.deep, true, 0, 0.96);
      ellipse(ctx, -17 * s, 6 * s, 5 * s, 3 * s, color, false, edgeWidth);
      ellipse(ctx, 17 * s, 6 * s, 5 * s, 3 * s, theme.deep, true, 0, 0.96);
      ellipse(ctx, 17 * s, 6 * s, 5 * s, 3 * s, color, false, edgeWidth);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -34 * s);
      ctx.bezierCurveTo(4.5 * s, -30 * s, 5 * s, -6 * s, 4.5 * s, 10 * s);
      ctx.lineTo(3 * s, 28 * s);
      ctx.lineTo(0, 32 * s);
      ctx.lineTo(-3 * s, 28 * s);
      ctx.lineTo(-4.5 * s, 10 * s);
      ctx.bezierCurveTo(-5 * s, -6 * s, -4.5 * s, -30 * s, 0, -34 * s);
      ctx.closePath();
      finishPath();

      ctx.beginPath();
      ctx.moveTo(-4 * s, -4 * s);
      ctx.lineTo(-36 * s, 8 * s);
      ctx.lineTo(-32 * s, 14 * s);
      ctx.lineTo(-4 * s, 10 * s);
      ctx.lineTo(4 * s, 10 * s);
      ctx.lineTo(32 * s, 14 * s);
      ctx.lineTo(36 * s, 8 * s);
      ctx.lineTo(4 * s, -4 * s);
      ctx.closePath();
      finishPath();

      ctx.beginPath();
      ctx.moveTo(-2.5 * s, 22 * s);
      ctx.lineTo(-13 * s, 28 * s);
      ctx.lineTo(-11 * s, 31 * s);
      ctx.lineTo(0, 28 * s);
      ctx.lineTo(11 * s, 31 * s);
      ctx.lineTo(13 * s, 28 * s);
      ctx.lineTo(2.5 * s, 22 * s);
      ctx.closePath();
      finishPath();
      ellipse(ctx, -14 * s, 8 * s, 4 * s, 4 * s, theme.deep, true, 0, 0.96);
      ellipse(ctx, -14 * s, 8 * s, 4 * s, 4 * s, color, false, edgeWidth);
      ellipse(ctx, 14 * s, 8 * s, 4 * s, 4 * s, theme.deep, true, 0, 0.96);
      ellipse(ctx, 14 * s, 8 * s, 4 * s, 4 * s, color, false, edgeWidth);
    }
    ctx.restore();
  }

  function renderAxes(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var topBand = height * 0.4;
    var dividerY = topBand;
    var cx = width * 0.265;
    var cy = topBand * 0.51;
    var spin = phase * TAU;
    var axisLength = Math.min(92, topBand * 0.42);

    function rotateAxis(x, y, z) {
      var cosY = Math.cos(spin * 0.35);
      var sinY = Math.sin(spin * 0.35);
      var x2 = x * cosY + z * sinY;
      var z2 = -x * sinY + z * cosY;
      var cosP = Math.cos(0.45);
      var sinP = Math.sin(0.45);
      var y2 = y * cosP - z2 * sinP;
      return { x: cx + x2, y: cy + y2 };
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(8, 8, width * 0.47, dividerY - 16);
    ctx.clip();
    var origin = rotateAxis(0, 0, 0);
    var xAxis = rotateAxis(axisLength, 0, 0);
    var yAxis = rotateAxis(0, -axisLength, 0);
    var zAxis = rotateAxis(0, 0, axisLength);
    ellipse(ctx, cx, cy + 34, 72, 14, theme.accent, true, 0, 0.08);
    ellipse(ctx, cx, cy + 34, 72, 14, theme.accent, false, 2, 0.32);
    arrow(ctx, origin.x, origin.y, xAxis.x, xAxis.y, theme.accent, 3.3, 12);
    arrow(ctx, origin.x, origin.y, yAxis.x, yAxis.y, theme.teal, 3.3, 12);
    arrow(ctx, origin.x, origin.y, zAxis.x, zAxis.y, theme.amber, 3.3, 12);
    circle(ctx, origin.x, origin.y, 7, theme.deep, true);
    circle(ctx, origin.x, origin.y, 7, theme.body, false, 1.5, 0.65);
    text(ctx, "ROLL", xAxis.x + 8, xAxis.y + 5, 17, theme.accentSoft, { mono: true, weight: 700 });
    text(ctx, "YAW", yAxis.x - 8, yAxis.y - 10, 17, theme.tealPale, { align: "center", mono: true, weight: 700 });
    text(ctx, "PITCH", zAxis.x + 8, zAxis.y + 5, 17, theme.amber, { mono: true, weight: 700 });
    ctx.restore();

    var cardX = width * 0.5;
    var cardY = 18;
    var cardW = width - cardX - 20;
    var cardH = dividerY - 34;
    panel(ctx, cardX, cardY, cardW, cardH, theme, theme.teal, 0.62);
    text(ctx, "DEFINED BY AXIS OF ROTATION", cardX + 18, cardY + 27, 16, theme.tealPale, {
      mono: true,
      weight: 700,
      maxWidth: cardW - 36
    });
    var definitions = [
      [theme.amber, "PITCH · lateral (Y)", "wingtip ↔ wingtip"],
      [theme.accent, "ROLL · longitudinal (X)", "nose ↔ tail"],
      [theme.teal, "YAW · vertical (Z)", "up ↔ down"]
    ];
    var rowStart = cardY + 58;
    var rowGap = Math.max(35, (cardH - 66) / 3);
    for (var di = 0; di < definitions.length; di += 1) {
      var defY = rowStart + rowGap * di;
      circle(ctx, cardX + 21, defY - 5, 4.5, definitions[di][0], true);
      text(ctx, definitions[di][1], cardX + 36, defY, 17, theme.body, {
        mono: true,
        weight: 700,
        maxWidth: cardW - 54
      });
      text(ctx, definitions[di][2], cardX + 36, defY + 19, 15, theme.dim, {
        weight: 500,
        maxWidth: cardW - 54
      });
    }

    line(ctx, 18, dividerY, width - 18, dividerY, theme.teal, 1.5, 0.25);
    var planes = [
      { title: "PITCH", cue: "side view", hint: "nose up / down", color: theme.amber, mode: "pitch" },
      { title: "ROLL", cue: "from behind", hint: "bank L / R", color: theme.accent, mode: "roll" },
      { title: "YAW", cue: "top-down", hint: "turn L / R", color: theme.teal, mode: "yaw" }
    ];
    var areaX = 14;
    var areaY = dividerY + 14;
    var areaW = width - 28;
    var areaH = height - areaY - 14;
    var gap = 10;
    var cellW = (areaW - gap * 2) / 3;
    var wave = Math.sin(phase * TAU);
    for (var pi = 0; pi < planes.length; pi += 1) {
      var plane = planes[pi];
      var px = areaX + pi * (cellW + gap);
      panel(ctx, px, areaY, cellW, areaH, theme, plane.color, 0.55);
      text(ctx, plane.title, px + cellW / 2, areaY + 31, 21, plane.color, { align: "center", mono: true, weight: 700 });
      text(ctx, plane.cue, px + cellW / 2, areaY + 54, 15, theme.dim, { align: "center", mono: true, weight: 600 });
      text(ctx, plane.hint, px + cellW / 2, areaY + areaH - 18, 18, theme.body, {
        align: "center",
        weight: 600,
        maxWidth: cellW - 24
      });
      var artTop = areaY + 68;
      var artBottom = areaY + areaH - 48;
      var planeCx = px + cellW / 2;
      var planeCy = (artTop + artBottom) / 2;
      ctx.save();
      ctx.strokeStyle = plane.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      if (plane.mode === "pitch") {
        ctx.ellipse(planeCx + 42, planeCy, 38, 74, 0, (-85 + wave * 20) * Math.PI / 180, (-20 + wave * 20) * Math.PI / 180);
      } else if (plane.mode === "roll") {
        ctx.ellipse(planeCx, planeCy - 4, 78, 55, 0, (200 + wave * 16) * Math.PI / 180, (340 + wave * 16) * Math.PI / 180);
      } else {
        ctx.ellipse(planeCx, planeCy + 15, 82, 48, 0, 200 * Math.PI / 180, (340 + wave * 14) * Math.PI / 180);
      }
      ctx.stroke();
      ctx.restore();
      var availableW = cellW * 0.78;
      var availableH = Math.max(80, artBottom - artTop);
      var scale = Math.min(availableW / 76, availableH / 72);
      scale = Math.max(1.9, Math.min(3.05, scale));
      drawAirplane(ctx, planeCx, planeCy, scale, plane.color, plane.mode, phase, theme);
    }
  }

  function render6Dof(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var cx = width * 0.235;
    var cy = height * 0.47;
    var bob = Math.sin(phase * TAU) * 7;
    fillRoundRect(ctx, cx - 55, cy - 34 + bob, 110, 52, 14, theme.deep, 0.95);
    strokeRoundRect(ctx, cx - 55, cy - 34 + bob, 110, 52, 14, theme.accent, 4, 1);
    circle(ctx, cx - 22, cy - 8 + bob, 10, theme.teal, false, 3);
    circle(ctx, cx + 22, cy - 8 + bob, 10, theme.teal, false, 3);
    line(ctx, cx - 63, cy - 22 + bob, cx - 84, cy - 5 + bob, theme.accent, 3);
    line(ctx, cx + 63, cy - 22 + bob, cx + 84, cy - 5 + bob, theme.accent, 3);

    var originY = cy + 43;
    arrow(ctx, cx, originY, cx + 102, originY, theme.accent, 3, 12);
    arrow(ctx, cx, originY, cx, cy - 91, theme.teal, 3, 12);
    arrow(ctx, cx, originY, cx - 75, originY + 43, theme.amber, 3, 12);
    text(ctx, "X", cx + 115, originY + 6, 20, theme.accentSoft, { mono: true, weight: 700 });
    text(ctx, "Y", cx + 8, cy - 94, 20, theme.tealPale, { mono: true, weight: 700 });
    text(ctx, "Z", cx - 94, originY + 56, 20, theme.amber, { mono: true, weight: 700 });

    ctx.save();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.34;
    ctx.beginPath();
    ctx.ellipse(cx, cy + bob, 94, 70, 0, -0.7, 0.7);
    ctx.stroke();
    ctx.restore();
    text(ctx, "pitch · roll · yaw", cx, height - 21, 17, theme.muted, { align: "center", mono: true, weight: 600 });

    var cardX = width * 0.49;
    panel(ctx, cardX, 22, width - cardX - 22, height - 44, theme, theme.teal, 0.55);
    circle(ctx, cardX + 24, 58, 5, theme.accent, true);
    text(ctx, "HEADSET = full 6DoF", cardX + 42, 65, 22, theme.tealPale, { mono: true, weight: 700 });
    text(ctx, "VIDEO = capture center only", cardX + 42, 96, 20, theme.body, { mono: true, weight: 700, maxWidth: width - cardX - 68 });
    line(ctx, cardX + 22, 115, width - 44, 115, theme.teal, 1.5, 0.22);
    text(ctx, "slide your body → new rays in the real room", cardX + 24, 148, 17, theme.muted, { maxWidth: width - cardX - 50 });
    text(ctx, "the file cannot invent those missing rays", cardX + 24, 178, 18, theme.amber, { maxWidth: width - cardX - 50, weight: 650 });
    text(ctx, "tracked pose ≠ recorded viewpoint", cardX + 24, 212, 16, theme.dim, { mono: true, maxWidth: width - cardX - 50 });
  }

  function renderHvs(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var cy = height * 0.42;
    var leftEye = width * 0.13;
    var rightEye = width * 0.28;
    var fusion = width * 0.46;
    var pupilShift = Math.sin(phase * TAU) * 5;

    ellipse(ctx, leftEye, cy, 48, 27, theme.accent, false, 3.5);
    ellipse(ctx, rightEye, cy, 48, 27, theme.accent, false, 3.5);
    circle(ctx, leftEye + pupilShift, cy, 10, theme.teal, true);
    circle(ctx, rightEye + pupilShift, cy, 10, theme.teal, true);
    circle(ctx, leftEye + pupilShift, cy, 4, theme.deep, true);
    circle(ctx, rightEye + pupilShift, cy, 4, theme.deep, true);
    text(ctx, "L", leftEye, cy + 55, 20, theme.tealPale, { align: "center", mono: true, weight: 700 });
    text(ctx, "R", rightEye, cy + 55, 20, theme.tealPale, { align: "center", mono: true, weight: 700 });

    var bracketY = cy + 78;
    line(ctx, leftEye, bracketY, rightEye, bracketY, theme.accent, 2, 0.48);
    line(ctx, leftEye, bracketY - 8, leftEye, bracketY + 8, theme.accent, 2, 0.48);
    line(ctx, rightEye, bracketY - 8, rightEye, bracketY + 8, theme.accent, 2, 0.48);
    text(ctx, "~63 mm IPD", (leftEye + rightEye) / 2, bracketY + 30, 16, theme.dim, { align: "center", mono: true });

    line(ctx, leftEye + 47, cy, fusion - 29, cy - 8, theme.teal, 2.2, 0.48);
    line(ctx, rightEye + 47, cy, fusion - 29, cy + 8, theme.teal, 2.2, 0.48);
    circle(ctx, fusion, cy, 27 + Math.sin(phase * TAU) * 3, theme.accent, false, 3);
    circle(ctx, fusion, cy, 20, theme.teal, true, 0, 0.12);
    text(ctx, "FUSION", fusion, cy + 6, 15, theme.tealPale, { align: "center", mono: true, weight: 700 });

    var boxX = width * 0.61;
    var boxW = width - boxX - 28;
    panel(ctx, boxX, 28, boxW, height - 56, theme, theme.teal, 0.54);
    text(ctx, "SBS CONTAINER", boxX + boxW / 2, 57, 17, theme.tealPale, { align: "center", mono: true, weight: 700 });
    var stripX = boxX + 34;
    var stripY = 76;
    var stripW = boxW - 68;
    var stripH = 62;
    fillRoundRect(ctx, stripX, stripY, stripW, stripH, 9, theme.card, 0.95);
    strokeRoundRect(ctx, stripX, stripY, stripW, stripH, 9, theme.accent, 2.2, 0.78);
    line(ctx, stripX + stripW / 2, stripY, stripX + stripW / 2, stripY + stripH, theme.accent, 2, 0.58);
    text(ctx, "L", stripX + stripW * 0.25, stripY + 39, 24, theme.tealPale, { align: "center", mono: true, weight: 700 });
    text(ctx, "R", stripX + stripW * 0.75, stripY + 39, 24, theme.tealPale, { align: "center", mono: true, weight: 700 });
    text(ctx, "each half → one eye buffer", boxX + boxW / 2, 169, 17, theme.body, { align: "center", maxWidth: boxW - 28 });
    text(ctx, "swap L/R → anti-stereo", boxX + boxW / 2, 204, 17, theme.amber, { align: "center", mono: true, maxWidth: boxW - 28 });
  }

  function renderMapping(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var footerH = 42;
    var gap = 12;
    var margin = 14;
    var cardW = (width - margin * 2 - gap * 2) / 3;
    var cardY = 14;
    var cardH = height - footerH - 22;
    var sweep = 30 + phase * 40;

    for (var i = 0; i < 3; i += 1) {
      var x = margin + i * (cardW + gap);
      panel(ctx, x, cardY, cardW, cardH, theme, theme.teal, 0.54);
      var cx = x + cardW / 2;
      var cy = cardY + cardH * 0.44;
      if (i === 0) {
        fillRoundRect(ctx, cx - 70, cy - 47, 140, 94, 10, theme.deep, 0.9);
        strokeRoundRect(ctx, cx - 70, cy - 47, 140, 94, 10, theme.accent, 4, 0.95);
        line(ctx, cx - 91, cy, cx - 108, cy - 12, theme.teal, 3, 0.55);
        line(ctx, cx - 91, cy, cx - 108, cy + 12, theme.teal, 3, 0.55);
        line(ctx, cx + 91, cy, cx + 108, cy - 12, theme.teal, 3, 0.55);
        line(ctx, cx + 91, cy, cx + 108, cy + 12, theme.teal, 3, 0.55);
      } else if (i === 1) {
        ctx.save();
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 5, 79, 62, 0, 200 * Math.PI / 180, 340 * Math.PI / 180);
        ctx.stroke();
        ctx.strokeStyle = theme.teal;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.ellipse(cx, cy + 5, 49, 31, 0, (220 + sweep) * Math.PI / 180, (240 + sweep) * Math.PI / 180);
        ctx.stroke();
        ctx.restore();
        line(ctx, cx - 69, cy + 36, cx + 69, cy + 36, theme.accent, 2, 0.45);
      } else {
        circle(ctx, cx, cy, 65, theme.accent, false, 4);
        circle(ctx, cx, cy, 39, theme.teal, false, 3, 0.5);
        circle(ctx, cx + Math.sin(phase * TAU) * 10, cy, 8, theme.teal, true);
        line(ctx, cx - 48, cy, cx + 48, cy, theme.teal, 1.5, 0.22);
        line(ctx, cx, cy - 48, cx, cy + 48, theme.teal, 1.5, 0.22);
      }
      var titles = ["FLAT", "180 / 360", "FISHEYE"];
      var subs = ["object in room", "equirect dome", "UV remap"];
      text(ctx, titles[i], cx, cardY + cardH - 48, 21, theme.tealPale, { align: "center", mono: true, weight: 700 });
      text(ctx, subs[i], cx, cardY + cardH - 20, 16, theme.dim, { align: "center", maxWidth: cardW - 24 });
    }
    text(ctx, "pixels → surface geometry · never fake FOV zoom", 24, height - 15, 17, theme.muted, { mono: true, weight: 600 });
  }

  function renderPipeline(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var stages = [
      ["DISK", "bytes"],
      ["DETECT", "lens / stereo"],
      ["DECODE", "Exo → GPU"],
      ["PROJECT", "mesh / UV"],
      ["XR", "layers"]
    ];
    var margin = 24;
    var gap = 24;
    var cardW = (width - margin * 2 - gap * (stages.length - 1)) / stages.length;
    var y = 52;
    var cardH = 92;
    var lit = Math.min(stages.length - 1, Math.floor(phase * stages.length));
    for (var i = 0; i < stages.length; i += 1) {
      var x = margin + i * (cardW + gap);
      fillRoundRect(ctx, x, y, cardW, cardH, 13, i === lit ? theme.accent : theme.deep, i === lit ? 0.2 : 0.66);
      strokeRoundRect(ctx, x, y, cardW, cardH, 13, i === lit ? theme.accent : theme.teal, i === lit ? 3 : 1.6, i === lit ? 0.95 : 0.32);
      if (i === lit) circle(ctx, x + cardW / 2, y - 16, 5, theme.accent, true);
      text(ctx, stages[i][0], x + cardW / 2, y + 39, 18, theme.tealPale, {
        align: "center",
        mono: true,
        weight: 700,
        maxWidth: cardW - 12
      });
      text(ctx, stages[i][1], x + cardW / 2, y + 69, 15, theme.dim, { align: "center", maxWidth: cardW - 12 });
      if (i < stages.length - 1) arrow(ctx, x + cardW + 4, y + cardH / 2, x + cardW + gap - 4, y + cardH / 2, theme.teal, 2, 8, 0.4);
    }
    text(ctx, "offline · local · yours", 28, height - 23, 18, theme.muted, { mono: true, weight: 700 });
  }

  function renderEuler(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, false);
    var waveH = 66;
    var gap = 12;
    var paneY = 12;
    var paneH = height - waveH - gap - paneY;
    var leftX = 12;
    var leftW = width * 0.49 - 18;
    var rightX = width * 0.5 + 6;
    var rightW = width - rightX - 12;
    panel(ctx, leftX, paneY, leftW, paneH, theme, theme.teal, 0.52);
    panel(ctx, rightX, paneY, rightW, paneH, theme, theme.amber, 0.52);
    fillRoundRect(ctx, 12, height - waveH, width - 24, waveH - 10, 11, theme.deep, 0.58);
    strokeRoundRect(ctx, 12, height - waveH, width - 24, waveH - 10, 11, theme.teal, 1.4, 0.22);

    var cx = leftX + leftW / 2;
    var cy = paneY + paneH / 2 - 2;
    var radius = Math.min(90, paneH * 0.36, leftW * 0.27);
    circle(ctx, cx, cy, radius, theme.accent, false, 3.2);
    line(ctx, cx - radius - 15, cy, cx + radius + 15, cy, theme.teal, 1.5, 0.28);
    line(ctx, cx, cy - radius - 15, cx, cy + radius + 15, theme.teal, 1.5, 0.28);
    text(ctx, "1", cx + radius + 18, cy + 6, 16, theme.dim, { mono: true });
    text(ctx, "i", cx, cy - radius - 15, 17, theme.dim, { align: "center", mono: true });
    text(ctx, "−1", cx - radius - 21, cy + 6, 16, theme.dim, { align: "right", mono: true });
    text(ctx, "−i", cx, cy + radius + 24, 17, theme.dim, { align: "center", mono: true });
    var angle = phase * TAU;
    for (var k = 12; k >= 0; k -= 1) {
      var trailAngle = angle - k * 0.14;
      var tx = cx + Math.cos(trailAngle) * radius;
      var ty = cy - Math.sin(trailAngle) * radius;
      circle(ctx, tx, ty, Math.max(2.2, 5 - k * 0.2), theme.amber, true, 0, Math.max(0.1, (200 - k * 14) / 255));
    }
    var pointX = cx + Math.cos(angle) * radius;
    var pointY = cy - Math.sin(angle) * radius;
    line(ctx, cx, cy, pointX, pointY, theme.amber, 4);
    line(ctx, pointX, pointY, pointX, cy, theme.teal, 2.3, 0.66);
    line(ctx, pointX, pointY, cx, pointY, theme.accent, 2.3, 0.66);
    circle(ctx, pointX, pointY, 7, theme.amber, true);
    text(ctx, "e^(iθ) rides the ring", cx, paneY + paneH - 17, 18, theme.amber, { align: "center", mono: true, weight: 700 });

    var tx0 = rightX + 26;
    var maxW = rightW - 52;
    text(ctx, "EULER'S FORMULA", tx0, paneY + 36, 20, theme.amber, { mono: true, weight: 700, maxWidth: maxW });
    text(ctx, "e^(iθ) = cos θ + i sin θ", tx0, paneY + 76, 22, theme.body, { mono: true, weight: 650, maxWidth: maxW });
    text(ctx, "at θ = π:", tx0, paneY + 111, 17, theme.dim, { mono: true });
    text(ctx, "e^(iπ) + 1 = 0", tx0, paneY + 146, 26, theme.tealPale, { mono: true, weight: 700, maxWidth: maxW });
    text(ctx, "e · i · π · 1 · 0", tx0, paneY + 181, 19, theme.amber, { mono: true, weight: 700 });
    text(ctx, "five constants, one postcard", tx0, paneY + 209, 16, theme.dim, { maxWidth: maxW });

    var waveTop = height - waveH;
    text(ctx, "cos θ · the same function unwrapped", 27, waveTop + 20, 14, theme.dim, { mono: true });
    ctx.save();
    ctx.strokeStyle = theme.teal;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (var wi = 0; wi <= 72; wi += 1) {
      var t = wi / 72;
      var wx = 27 + (width - 54) * t;
      var wy = waveTop + 41 - Math.sin((t * 4 + phase) * TAU) * 9;
      if (wi === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function renderDeeperIntro(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, true);
    var nodes = [
      ["THEORY", "the map", theme.teal],
      ["DEEPER", "the engine bay", theme.green],
      ["QUAT · FRAMES · MATH", "the machinery", theme.green]
    ];
    var margin = 36;
    var gap = 50;
    var nodeW = (width - margin * 2 - gap * 2) / 3;
    var y = 37;
    var h = 91;
    for (var i = 0; i < nodes.length; i += 1) {
      var x = margin + i * (nodeW + gap);
      panel(ctx, x, y, nodeW, h, theme, nodes[i][2], 0.58);
      text(ctx, nodes[i][0], x + nodeW / 2, y + 39, i === 2 ? 17 : 21, nodes[i][2], {
        align: "center",
        mono: true,
        weight: 700,
        maxWidth: nodeW - 18
      });
      text(ctx, nodes[i][1], x + nodeW / 2, y + 68, 15, theme.dim, { align: "center", maxWidth: nodeW - 18 });
      if (i < nodes.length - 1) arrow(ctx, x + nodeW + 9, y + h / 2, x + nodeW + gap - 9, y + h / 2, theme.green, 2.5, 10, 0.7);
    }
    var pulse = 0.5 + 0.5 * Math.sin(phase * TAU);
    circle(ctx, margin + nodeW + gap + nodeW / 2, y - 14, 5 + pulse * 4, theme.green, true, 0, 0.8);
    text(ctx, "optional room · green means you left the shallow end", 37, height - 21, 17, theme.muted, { mono: true, weight: 600 });
  }

  function signed(value) {
    var normalized = Math.abs(value) < 0.005 ? 0 : value;
    return (normalized >= 0 ? "+" : "−") + Math.abs(normalized).toFixed(2);
  }

  function renderQuat(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, true);
    var cx = width * 0.265;
    var cy = height * 0.49;
    var radius = Math.min(88, height * 0.31);
    circle(ctx, cx, cy, radius, theme.teal, false, 2, 0.35);
    circle(ctx, cx, cy, radius, theme.green, false, 4, 0.9);
    var angle = phase * TAU;
    var ux = Math.sin(angle);
    var uy = -Math.cos(angle);
    var tipX = cx + ux * radius;
    var tipY = cy + uy * radius;
    arrow(ctx, cx, cy, tipX, tipY, theme.green, 4.5, 14);
    circle(ctx, tipX, tipY, 7, theme.green, true);
    text(ctx, "û", cx + ux * (radius + 25), cy + uy * (radius + 25) + 6, 21, theme.tealPale, { align: "center", mono: true, weight: 700 });
    text(ctx, "û on the unit ring", cx, height - 21, 17, theme.muted, { align: "center", mono: true });

    var cardX = width * 0.49;
    var cardY = 20;
    var cardW = width - cardX - 22;
    var cardH = height - 40;
    panel(ctx, cardX, cardY, cardW, cardH, theme, theme.green, 0.59);
    text(ctx, "q = ( w, x, y, z )", cardX + 28, cardY + 42, 23, theme.green, { mono: true, weight: 700, maxWidth: cardW - 56 });
    line(ctx, cardX + 24, cardY + 59, cardX + cardW - 24, cardY + 59, theme.green, 1.4, 0.22);
    var halfAngle = phase * TAU;
    var scalar = Math.cos(halfAngle / 2);
    var sine = Math.sin(halfAngle / 2);
    var rows = [
      ["w", signed(scalar), "cos(θ/2)"],
      ["x", signed(sine * ux), "ûₓ sin(θ/2)"],
      ["y", signed(sine * uy), "ûᵧ sin(θ/2)"],
      ["z", "+0.00", "û_z sin(θ/2)"]
    ];
    for (var i = 0; i < rows.length; i += 1) {
      var rowY = cardY + 91 + i * 36;
      text(ctx, rows[i][0], cardX + 31, rowY, 19, theme.tealPale, { mono: true, weight: 700 });
      text(ctx, rows[i][1], cardX + 83, rowY, 19, theme.body, { mono: true, weight: 650 });
      text(ctx, rows[i][2], cardX + 190, rowY, 16, theme.dim, { mono: true, maxWidth: cardW - 215 });
    }
    text(ctx, "‖q‖ = 1 · q ≡ −q on SO(3)", cardX + 28, cardY + cardH - 22, 17, theme.muted, { mono: true, maxWidth: cardW - 56 });
  }

  function renderFrames(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, true);
    var stages = [
      ["WORLD", "room m"],
      ["HEAD", "pose q, t"],
      ["EYE", "±IPD / 2"],
      ["CLIP", "−1 … 1"]
    ];
    var margin = 26;
    var gap = 30;
    var cardW = (width - margin * 2 - gap * 3) / 4;
    var y = 51;
    var h = 91;
    var lit = Math.min(3, Math.floor(phase * 4));
    for (var i = 0; i < stages.length; i += 1) {
      var x = margin + i * (cardW + gap);
      fillRoundRect(ctx, x, y, cardW, h, 13, i === lit ? theme.green : theme.deep, i === lit ? 0.18 : 0.66);
      strokeRoundRect(ctx, x, y, cardW, h, 13, i === lit ? theme.green : theme.teal, i === lit ? 3 : 1.6, i === lit ? 0.92 : 0.28);
      text(ctx, stages[i][0], x + cardW / 2, y + 38, 19, theme.tealPale, { align: "center", mono: true, weight: 700 });
      text(ctx, stages[i][1], x + cardW / 2, y + 67, 15, theme.dim, { align: "center", mono: true, maxWidth: cardW - 16 });
      if (i < stages.length - 1) arrow(ctx, x + cardW + 5, y + h / 2, x + cardW + gap - 5, y + h / 2, theme.green, 2, 9, 0.54);
    }
    text(ctx, "clip = P · V · M · vertex", 30, height - 68, 24, theme.green, { mono: true, weight: 700 });
    text(ctx, "projection · view(pose⁻¹) · model(content)", 30, height - 28, 17, theme.muted, { mono: true, maxWidth: width - 60 });
  }

  function renderGimbal(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, true);
    var cx = width * 0.29;
    var cy = height * 0.48;
    var collapse = Math.max(0, Math.min(1, 0.5 + 0.5 * Math.sin(phase * TAU)));
    var outer = 102;
    var middle = 72;
    var inner = 43;
    ellipse(ctx, cx, cy, outer, outer * 0.35, theme.accent, false, 4);
    ellipse(ctx, cx, cy, middle, middle * (0.35 + collapse * 0.55), theme.amber, false, 4);
    ellipse(ctx, cx, cy, inner, inner * (0.9 - collapse * 0.55), theme.teal, false, 4);
    circle(ctx, cx, cy, 7, theme.green, true);
    text(ctx, "YAW", cx - outer - 20, cy - 3, 15, theme.accentSoft, { align: "right", mono: true, weight: 700 });
    text(ctx, "PITCH", cx, cy - 83, 15, theme.amber, { align: "center", mono: true, weight: 700 });
    text(ctx, "ROLL", cx + inner + 12, cy + 7, 15, theme.tealPale, { mono: true, weight: 700 });
    text(ctx, "Euler gimbals", cx, height - 23, 17, theme.muted, { align: "center", mono: true });

    var cardX = width * 0.53;
    var cardW = width - cardX - 24;
    panel(ctx, cardX, 24, cardW, height - 48, theme, collapse > 0.88 ? theme.accent : theme.green, 0.58);
    circle(ctx, cardX + 27, 60, 5, collapse > 0.88 ? theme.accent : theme.green, true);
    text(ctx, "MIDDLE RING → ±90°", cardX + 46, 67, 20, theme.tealPale, { mono: true, weight: 700, maxWidth: cardW - 68 });
    text(ctx, "outer ∥ inner", cardX + 28, 105, 19, theme.body, { mono: true });
    text(ctx, "ONE DEGREE OF FREEDOM LOST", cardX + 28, 141, 20, theme.accentSoft, { mono: true, weight: 700, maxWidth: cardW - 56 });
    line(ctx, cardX + 26, 161, cardX + cardW - 26, 161, theme.green, 1.5, 0.22);
    text(ctx, "STORE · quaternion", cardX + 28, 194, 17, theme.green, { mono: true, weight: 700 });
    text(ctx, "SHOW · Euler readout only", cardX + 28, 225, 17, theme.muted, { mono: true, maxWidth: cardW - 56 });
  }

  function renderMath(ctx, width, height, theme, phase) {
    backdrop(ctx, width, height, theme, true);
    var cells = [
      ["VECTOR", "v′ = R v", "direction in a frame"],
      ["MATRIX", "4 × 4 affine", "R + t in one shot"],
      ["QUAT", "q₂ q₁", "compose rotations"]
    ];
    var margin = 16;
    var gap = 14;
    var cellW = (width - margin * 2 - gap * 2) / 3;
    var y = 16;
    var h = height - 32;
    var lit = Math.min(2, Math.floor(phase * 3));
    for (var i = 0; i < cells.length; i += 1) {
      var x = margin + i * (cellW + gap);
      panel(ctx, x, y, cellW, h, theme, i === lit ? theme.green : theme.teal, 0.56);
      if (i === lit) strokeRoundRect(ctx, x + 2, y + 2, cellW - 4, h - 4, 12, theme.green, 3, 0.75);
      text(ctx, cells[i][0], x + cellW / 2, y + 40, 20, i === 2 ? theme.green : theme.accentSoft, { align: "center", mono: true, weight: 700 });
      text(ctx, cells[i][1], x + cellW / 2, y + 104, 25, theme.tealPale, { align: "center", mono: true, weight: 700, maxWidth: cellW - 28 });
      if (i === 0) {
        arrow(ctx, x + cellW / 2 - 34, y + 154, x + cellW / 2 + 35, y + 137, theme.green, 3, 12);
      } else if (i === 1) {
        var mx = x + cellW / 2;
        var my = y + 146;
        strokeRoundRect(ctx, mx - 24, my - 24, 48, 48, 3, theme.green, 3, 0.75);
        line(ctx, mx, my - 24, mx, my + 24, theme.teal, 1.5, 0.42);
        line(ctx, mx - 24, my, mx + 24, my, theme.teal, 1.5, 0.42);
      } else {
        circle(ctx, x + cellW / 2 - 18, y + 146, 18, theme.teal, false, 3, 0.52);
        circle(ctx, x + cellW / 2 + 18, y + 146, 18, theme.green, false, 3, 0.9);
      }
      text(ctx, cells[i][2], x + cellW / 2, y + h - 27, 17, theme.muted, { align: "center", maxWidth: cellW - 24 });
    }
  }

  var renderers = {
    theory_overview: renderOverview,
    theory_axes: renderAxes,
    theory_6dof: render6Dof,
    theory_hvs: renderHvs,
    theory_mapping: renderMapping,
    theory_pipeline: renderPipeline,
    theory_euler: renderEuler,
    theory_deeper_intro: renderDeeperIntro,
    theory_quat: renderQuat,
    theory_frames: renderFrames,
    theory_gimbal: renderGimbal,
    theory_math: renderMath
  };

  function resizeBitmap(state) {
    var rect = state.canvas.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(MAX_DPR, window.devicePixelRatio || 1));
    var cssWidth = rect.width;
    var cssHeight = rect.height;
    if (!cssWidth || !cssHeight) {
      if (state.live) return false;
      cssWidth = state.logicalWidth;
      cssHeight = state.logicalHeight;
    }
    var pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    var pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (state.canvas.width !== pixelWidth || state.canvas.height !== pixelHeight) {
      state.canvas.width = pixelWidth;
      state.canvas.height = pixelHeight;
    }
    state.cssWidth = cssWidth;
    state.cssHeight = cssHeight;
    state.dpr = dpr;
    return true;
  }

  function failState(state, error) {
    state.failed = true;
    state.visible = false;
    state.dirty = false;
    if (state.figure && state.figure.classList) state.figure.classList.remove("diagram-live");
    if (intersectionObserver) intersectionObserver.unobserve(state.canvas);
    if (resizeObserver) resizeObserver.unobserve(state.canvas);
    states.delete(state);
    stateByCanvas.delete(state.canvas);
    if (window.console && typeof window.console.error === "function") {
      window.console.error("Finally theory diagram failed: " + state.key, error);
    }
  }

  function drawState(state, now) {
    try {
      if (!resizeBitmap(state)) return;
      var ctx = state.context;
      var canvas = state.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      var scaleX = state.cssWidth / state.logicalWidth;
      var scaleY = state.cssHeight / state.logicalHeight;
      ctx.setTransform(state.dpr * scaleX, 0, 0, state.dpr * scaleY, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      var phase = reduceMotion ? 0.125 : (now % PERIOD_MS) / PERIOD_MS;
      state.renderer(ctx, state.logicalWidth, state.logicalHeight, state.theme, phase);
      state.dirty = false;
      if (!state.live) {
        state.live = true;
        if (state.figure && state.figure.classList) state.figure.classList.add("diagram-live");
      }
    } catch (error) {
      failState(state, error);
    }
  }

  function anyVisible() {
    var visible = false;
    states.forEach(function (state) {
      if (state.visible) visible = true;
    });
    return visible;
  }

  function tick(now) {
    frameRequest = 0;
    if (document.hidden) return;
    states.forEach(function (state) {
      if (state.visible || state.dirty) drawState(state, now);
    });
    if (!reduceMotion && anyVisible()) frameRequest = window.requestAnimationFrame(tick);
  }

  function schedule() {
    if (!frameRequest && !document.hidden) frameRequest = window.requestAnimationFrame(tick);
  }

  function ensureObservers() {
    if (!intersectionObserver && typeof window.IntersectionObserver === "function") {
      intersectionObserver = new window.IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          var state = stateByCanvas.get(entry.target);
          if (!state) return;
          state.visible = entry.isIntersecting && entry.intersectionRatio > 0;
          if (state.visible) {
            state.dirty = true;
            schedule();
          }
        });
      }, { rootMargin: "160px 0px", threshold: 0.01 });
    }
    if (!resizeObserver && typeof window.ResizeObserver === "function") {
      resizeObserver = new window.ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          var state = stateByCanvas.get(entry.target);
          if (!state) return;
          state.dirty = true;
        });
        schedule();
      });
    }
    if (!motionQuery && window.matchMedia) {
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      reduceMotion = motionQuery.matches;
      var onMotionChange = function (event) {
        reduceMotion = event.matches;
        states.forEach(function (state) { state.dirty = true; });
        schedule();
      };
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
      else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
    }
  }

  function registerCanvas(canvas) {
    if (stateByCanvas.has(canvas)) return true;
    var key = canvas.getAttribute("data-theory-diagram");
    var renderer = renderers[key];
    if (!renderer) return false;
    var context = canvas.getContext("2d");
    if (!context) return false;

    var logicalWidth = Number(canvas.getAttribute("width")) || 960;
    var logicalHeight = Number(canvas.getAttribute("height")) || 240;
    var figure = canvas.closest ? canvas.closest(".theory-figure") : canvas.parentElement;
    var state = {
      canvas: canvas,
      context: context,
      key: key,
      renderer: renderer,
      figure: figure,
      logicalWidth: logicalWidth,
      logicalHeight: logicalHeight,
      theme: readTheme(),
      visible: typeof window.IntersectionObserver !== "function",
      dirty: true,
      live: false,
      failed: false,
      cssWidth: 0,
      cssHeight: 0,
      dpr: 1
    };
    stateByCanvas.set(canvas, state);
    states.add(state);
    if (intersectionObserver) intersectionObserver.observe(canvas);
    if (resizeObserver) resizeObserver.observe(canvas);
    return true;
  }

  function init(root) {
    ensureObservers();
    var scope = root && root.querySelectorAll ? root : document;
    var canvases = scope.querySelectorAll("canvas[data-theory-diagram]");
    var count = 0;
    for (var i = 0; i < canvases.length; i += 1) {
      if (registerCanvas(canvases[i])) count += 1;
    }
    schedule();
    return count;
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      states.forEach(function (state) { state.dirty = true; });
      schedule();
    } else if (frameRequest) {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
  });

  window.FinallyTheoryDiagrams = { init: init };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(document); }, { once: true });
  } else {
    init(document);
  }
}());
