import type { CreativeVariation, PosterContent, Tone } from "../types";

export const POSTER_W = 1080;
export const POSTER_H = 1350;

function isNoOffer(value: string): boolean {
  return /^(?:no(?:\s+(?:discount|offer|offers|promotion|and|or)){1,4}|no offer provided|not provided|none|n\/a|na)$/i.test(value.trim());
}

const FONT_SANS = `"Plus Jakarta Sans", "Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
const FONT_SERIF = `"Playfair Display", "Cormorant Garamond", Georgia, serif`;
const FONT_DISPLAY = `"Montserrat", "Plus Jakarta Sans", "Inter", sans-serif`;

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function clamp(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const chars = Array.from(text.replace(/…$/, ""));
  let t = text;
  while (chars.length > 1 && ctx.measureText(t).width > maxWidth) {
    chars.pop();
    t = `${chars.join("").trimEnd()}…`;
  }
  return t;
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  weight: string,
  maxPx: number,
  minPx: number,
  maxWidth: number,
  maxLines: number,
  style = "",
): { size: number; lines: string[] } {
  let size = maxPx;
  while (size >= minPx) {
    ctx.font = `${style} ${weight} ${size}px ${fontFamily}`.trim();
    const lines = wrapLines(ctx, text, maxWidth);
    const widest = lines.length ? Math.max(...lines.map((l) => ctx.measureText(l).width)) : 0;
    if (lines.length <= maxLines && widest <= maxWidth) {
      return { size, lines };
    }
    size -= 2;
  }
  ctx.font = `${style} ${weight} ${minPx}px ${fontFamily}`.trim();
  const all = wrapLines(ctx, text, maxWidth);
  const kept = all.slice(0, maxLines);
  const lines = kept.map((l, i) =>
    clamp(ctx, i === kept.length - 1 && all.length > maxLines ? `${l}…` : l, maxWidth),
  );
  return { size: minPx, lines };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
) {
  const [tl, tr, br, bl] = typeof r === "number" ? [r, r, r, r] : r;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

function drawCoverClipped(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();

  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;

  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  }
}

function resetSpacing(ctx: CanvasRenderingContext2D) {
  setSpacing(ctx, 0);
}

/* ==========================================================================
   1. LUXURY / PREMIUM VARIATION
   ========================================================================== */
function renderLuxuryVariation(
  ctx: CanvasRenderingContext2D,
  content: PosterContent,
  image: HTMLImageElement | null,
) {
  const W = POSTER_W;
  const H = POSTER_H;

  // Rich obsidian base background
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#08090C");
  bgGrad.addColorStop(0.5, "#10121A");
  bgGrad.addColorStop(1, "#0A0B10");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Subtle luxury ambient warm gold glow
  const glow = ctx.createRadialGradient(W / 2, 200, 50, W / 2, 200, 600);
  glow.addColorStop(0, "rgba(212, 175, 55, 0.08)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Elegant hairline double-border with corner notches
  ctx.save();
  ctx.strokeStyle = "rgba(212, 175, 55, 0.35)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 36, 36, W - 72, H - 72, 28);
  ctx.stroke();

  ctx.strokeStyle = "rgba(212, 175, 55, 0.15)";
  ctx.lineWidth = 1;
  roundRect(ctx, 44, 44, W - 88, H - 88, 22);
  ctx.stroke();
  ctx.restore();

  // Top Subtitle / Tagline
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  setSpacing(ctx, 5);
  ctx.fillStyle = "#D4AF37";
  ctx.font = `600 20px ${FONT_SANS}`;
  ctx.fillText((content.businessType || "LOCAL BUSINESS").toUpperCase(), W / 2, 82);
  resetSpacing(ctx);

  // Business Name in elegant Serif
  const nameFit = fitText(ctx, content.businessName.toUpperCase(), FONT_SERIF, "700", 48, 28, W - 180, 1);
  ctx.fillStyle = "#FAF8F5";
  ctx.font = `700 ${nameFit.size}px ${FONT_SERIF}`;
  ctx.fillText(nameFit.lines[0] || content.businessName, W / 2, 128);

  // Hero Showcase Card
  const imgX = 72;
  const imgY = 175;
  const imgW = W - 144; // 936
  const imgH = 560;
  const radius = 24;

  if (image) {
    drawCoverClipped(ctx, image, imgX, imgY, imgW, imgH, radius);

    // Subtle dark gradient vignette at bottom of photo
    ctx.save();
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.clip();
    const scrim = ctx.createLinearGradient(0, imgY + imgH - 180, 0, imgY + imgH);
    scrim.addColorStop(0, "transparent");
    scrim.addColorStop(1, "rgba(8, 9, 12, 0.75)");
    ctx.fillStyle = scrim;
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.restore();

    // High-end photo gold border
    ctx.save();
    ctx.strokeStyle = "rgba(212, 175, 55, 0.45)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();
    ctx.restore();

    // Floating gold luxury badge
    const badgeW = 240;
    const badgeH = 46;
    const badgeX = imgX + imgW - badgeW - 20;
    const badgeY = imgY + 20;
    ctx.save();
    ctx.fillStyle = "rgba(10, 11, 16, 0.88)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 23);
    ctx.fill();
    ctx.strokeStyle = "rgba(212, 175, 55, 0.8)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 23);
    ctx.stroke();
    setSpacing(ctx, 2);
    ctx.fillStyle = "#E8D59A";
    ctx.font = `700 16px ${FONT_SANS}`;
    ctx.fillText((content.businessType || "FEATURED").toUpperCase(), badgeX + badgeW / 2, badgeY + badgeH / 2);
    resetSpacing(ctx);
    ctx.restore();
  } else {
    // Elegant luxury graphic placeholder card
    ctx.save();
    const cardGrad = ctx.createLinearGradient(imgX, imgY, imgX + imgW, imgY + imgH);
    cardGrad.addColorStop(0, "#131622");
    cardGrad.addColorStop(0.5, "#1B1E2E");
    cardGrad.addColorStop(1, "#111420");
    ctx.fillStyle = cardGrad;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(212, 175, 55, 0.3)";
    ctx.lineWidth = 2;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();

    ctx.fillStyle = "rgba(212, 175, 55, 0.12)";
    ctx.beginPath();
    ctx.arc(W / 2, imgY + imgH / 2 - 20, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(212, 175, 55, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#D4AF37";
    ctx.font = `600 64px ${FONT_SERIF}`;
    ctx.fillText("✦", W / 2, imgY + imgH / 2 - 25);

    setSpacing(ctx, 4);
    ctx.font = `600 22px ${FONT_SANS}`;
    ctx.fillStyle = "#E8D59A";
    resetSpacing(ctx);
    ctx.restore();
  }

  // --- Bottom Content: Offer & Typography Section ---
  const bottomY = 760;

  // Main Offer Badge / Plaque
  const displayOffer = (content.mainOffer || content.headline || "").toUpperCase();
  const offerFit = fitText(ctx, displayOffer, FONT_SERIF, "800", 64, 34, W - 220, 1);
  const offerW = Math.min(W - 200, ctx.measureText(offerFit.lines[0]).width + 90);
  const offerH = 74;
  const offerBoxX = (W - offerW) / 2;
  const offerBoxY = bottomY;

  ctx.save();
  const goldPlaque = ctx.createLinearGradient(offerBoxX, offerBoxY, offerBoxX + offerW, offerBoxY + offerH);
  goldPlaque.addColorStop(0, "#E8CE7A");
  goldPlaque.addColorStop(0.5, "#D4AF37");
  goldPlaque.addColorStop(1, "#B88E28");
  ctx.fillStyle = goldPlaque;
  ctx.shadowColor = "rgba(212, 175, 55, 0.35)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, offerBoxX, offerBoxY, offerW, offerH, 16);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#0A0B10";
  ctx.font = `800 ${offerFit.size}px ${FONT_SERIF}`;
  ctx.fillText(offerFit.lines[0], W / 2, offerBoxY + offerH / 2);

  // Price Line
  let currentY = offerBoxY + offerH + 34;
  if (content.priceLine) {
    ctx.fillStyle = "#E8D59A";
    ctx.font = `600 26px ${FONT_SANS}`;
    ctx.fillText(`✨ ${content.priceLine}`, W / 2, currentY);
    currentY += 38;
  }

  // Headline / Service Title
  const primaryTitle = content.headline || content.service;
  const titleFit = fitText(ctx, primaryTitle, FONT_SERIF, "700", 46, 26, W - 180, 2);
  ctx.fillStyle = "#FAF8F5";
  ctx.font = `700 ${titleFit.size}px ${FONT_SERIF}`;
  for (const line of titleFit.lines) {
    ctx.fillText(line, W / 2, currentY);
    currentY += titleFit.size * 1.15;
  }

  // Subheadline / Benefit
  const benefitText = content.subheadline || content.benefit;
  if (benefitText) {
    ctx.fillStyle = "#C8BA96";
    ctx.font = `italic 500 24px ${FONT_SERIF}`;
    const benLine = clamp(ctx, `— ${benefitText} —`, W - 200);
    ctx.fillText(benLine, W / 2, currentY + 8);
    currentY += 42;
  }

  // CTA Pill Button
  const ctaFit = fitText(ctx, content.cta.toUpperCase(), FONT_SANS, "800", 30, 20, W - 280, 1);
  const ctaBtnW = Math.min(W - 240, Math.max(380, ctx.measureText(ctaFit.lines[0]).width + 120));
  const ctaBtnH = 74;
  const ctaBtnX = (W - ctaBtnW) / 2;
  const ctaBtnY = Math.min(H - 175, Math.max(currentY + 14, 1140));

  ctx.save();
  const ctaGrad = ctx.createLinearGradient(ctaBtnX, ctaBtnY, ctaBtnX + ctaBtnW, ctaBtnY + ctaBtnH);
  ctaGrad.addColorStop(0, "#FAF8F5");
  ctaGrad.addColorStop(1, "#E5D8B8");
  ctx.fillStyle = ctaGrad;
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, ctaBtnX, ctaBtnY, ctaBtnW, ctaBtnH, ctaBtnH / 2);
  ctx.fill();
  ctx.restore();

  setSpacing(ctx, 2);
  ctx.fillStyle = "#0A0B10";
  ctx.font = `800 ${ctaFit.size}px ${FONT_SANS}`;
  ctx.fillText(`✦  ${ctaFit.lines[0]}  ✦`, W / 2, ctaBtnY + ctaBtnH / 2 + 1);
  resetSpacing(ctx);

  // Footer / Location Bar
  if (content.location) {
    setSpacing(ctx, 3);
    ctx.fillStyle = "rgba(212, 175, 55, 0.85)";
    ctx.font = `600 20px ${FONT_SANS}`;
    const locText = `📍 ${content.location.toUpperCase()}   •   LIMITED APPOINTMENTS`;
    ctx.fillText(clamp(ctx, locText, W - 140), W / 2, H - 65);
    resetSpacing(ctx);
  }
}

/* ==========================================================================
   2. BOLD / HIGH-CONVERSION VARIATION
   ========================================================================== */
function renderBoldVariation(
  ctx: CanvasRenderingContext2D,
  content: PosterContent,
  image: HTMLImageElement | null,
) {
  const W = POSTER_W;
  const H = POSTER_H;

  // Deep High-Impact Midnight Navy Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#080E1E");
  bg.addColorStop(0.5, "#0D162B");
  bg.addColorStop(1, "#050914");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Dynamic promotional diagonal accent stripes
  ctx.save();
  ctx.fillStyle = "rgba(255, 51, 102, 0.05)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(400, 0);
  ctx.lineTo(0, 400);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255, 221, 0, 0.04)";
  ctx.beginPath();
  ctx.moveTo(W, H);
  ctx.lineTo(W - 450, H);
  ctx.lineTo(W, H - 450);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Top Header Bar
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Urgent Flash Deal Ribbon
  const tagW = 320;
  const tagH = 44;
  const tagX = (W - tagW) / 2;
  const tagY = 48;
  ctx.save();
  ctx.fillStyle = "#FF3366";
  ctx.shadowColor = "rgba(255, 51, 102, 0.4)";
  ctx.shadowBlur = 14;
  roundRect(ctx, tagX, tagY, tagW, tagH, 10);
  ctx.fill();
  ctx.restore();

  setSpacing(ctx, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 18px ${FONT_DISPLAY}`;
  ctx.fillText((content.businessType || "LOCAL BUSINESS").toUpperCase(), W / 2, tagY + tagH / 2);
  resetSpacing(ctx);

  // Business Name in Bold Impact Display
  const nameFit = fitText(ctx, content.businessName.toUpperCase(), FONT_DISPLAY, "900", 52, 28, W - 160, 1);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${nameFit.size}px ${FONT_DISPLAY}`;
  ctx.fillText(nameFit.lines[0] || content.businessName, W / 2, 134);

  // Hero Focal Image Showcase
  const imgX = 64;
  const imgY = 175;
  const imgW = W - 128; // 952
  const imgH = 570;
  const radius = 28;

  if (image) {
    drawCoverClipped(ctx, image, imgX, imgY, imgW, imgH, radius);

    // Deep dark contrast gradient at bottom of photo
    ctx.save();
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.clip();
    const shade = ctx.createLinearGradient(0, imgY + imgH - 160, 0, imgY + imgH);
    shade.addColorStop(0, "transparent");
    shade.addColorStop(1, "rgba(5, 9, 20, 0.85)");
    ctx.fillStyle = shade;
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.restore();

    // Crisp high-impact border
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 3;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();
    ctx.restore();

    if (content.mainOffer) {
      const badgeW = 280;
      const badgeH = 64;
      const badgeX = imgX + 24;
      const badgeY = imgY + 24;
      ctx.save();
      ctx.fillStyle = "#FFDD00";
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
      roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "#0A0F1E";
      ctx.font = `900 24px ${FONT_DISPLAY}`;
      ctx.fillText(`🔥 ${content.mainOffer}`, badgeX + badgeW / 2, badgeY + badgeH / 2);
    }
  } else {
    // High-impact promotional hero card
    ctx.save();
    const heroBg = ctx.createLinearGradient(imgX, imgY, imgX + imgW, imgY + imgH);
    heroBg.addColorStop(0, "#16223F");
    heroBg.addColorStop(1, "#0E172C");
    ctx.fillStyle = heroBg;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 221, 0, 0.4)";
    ctx.lineWidth = 3;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();

    ctx.fillStyle = "#FF3366";
    ctx.font = `900 80px ${FONT_DISPLAY}`;
    ctx.fillText("⚡", W / 2, imgY + imgH / 2 - 35);

    ctx.fillStyle = "#FFDD00";
    ctx.font = `900 48px ${FONT_DISPLAY}`;
    ctx.fillText("", W / 2, imgY + imgH / 2 + 45);
    ctx.restore();
  }

  // --- Bottom Promotional Section ---
  const bottomY = 770;

  // Massive Promotional Offer Banner Box
  const displayOffer = (content.mainOffer || content.headline || "").toUpperCase();
  const offerFit = fitText(ctx, displayOffer, FONT_DISPLAY, "900", 68, 36, W - 200, 1);
  const offerBoxW = Math.min(W - 160, Math.max(500, ctx.measureText(offerFit.lines[0]).width + 120));
  const offerBoxH = 84;
  const offerBoxX = (W - offerBoxW) / 2;
  const offerBoxY = bottomY;

  ctx.save();
  const offerGrad = ctx.createLinearGradient(offerBoxX, offerBoxY, offerBoxX + offerBoxW, offerBoxY + offerBoxH);
  offerGrad.addColorStop(0, "#FFDD00");
  offerGrad.addColorStop(1, "#FFAA00");
  ctx.fillStyle = offerGrad;
  ctx.shadowColor = "rgba(255, 221, 0, 0.45)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, offerBoxX, offerBoxY, offerBoxW, offerBoxH, 20);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#0A0E1E";
  ctx.font = `900 ${offerFit.size}px ${FONT_DISPLAY}`;
  ctx.fillText(offerFit.lines[0], W / 2, offerBoxY + offerBoxH / 2 + 2);

  let currentY = offerBoxY + offerBoxH + 34;
  if (content.priceLine) {
    ctx.fillStyle = "#FFDD00";
    ctx.font = `800 28px ${FONT_DISPLAY}`;
    ctx.fillText(`⚡ ${content.priceLine.toUpperCase()}`, W / 2, currentY);
    currentY += 40;
  }

  // Headline / Service in Ultra-Bold
  const primaryTitle = (content.headline || content.service).toUpperCase();
  const titleFit = fitText(ctx, primaryTitle, FONT_DISPLAY, "900", 46, 26, W - 160, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${titleFit.size}px ${FONT_DISPLAY}`;
  for (const line of titleFit.lines) {
    ctx.fillText(line, W / 2, currentY);
    currentY += titleFit.size * 1.12;
  }

  // Benefit tagline
  const benefitText = content.subheadline || content.benefit;
  if (benefitText) {
    ctx.fillStyle = "#94A3B8";
    ctx.font = `600 24px ${FONT_DISPLAY}`;
    const benLine = clamp(ctx, `✓ ${benefitText}`, W - 180);
    ctx.fillText(benLine, W / 2, currentY + 8);
    currentY += 40;
  }

  // Big Action CTA Button
  const ctaFit = fitText(ctx, content.cta.toUpperCase(), FONT_DISPLAY, "900", 32, 22, W - 260, 1);
  const ctaW = Math.min(W - 200, Math.max(420, ctx.measureText(ctaFit.lines[0]).width + 140));
  const ctaH = 80;
  const ctaX = (W - ctaW) / 2;
  const ctaY = Math.min(H - 175, Math.max(currentY + 12, 1140));

  ctx.save();
  const ctaBg = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaW, ctaY + ctaH);
  ctaBg.addColorStop(0, "#FF3366");
  ctaBg.addColorStop(1, "#E60039");
  ctx.fillStyle = ctaBg;
  ctx.shadowColor = "rgba(255, 51, 102, 0.5)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `900 ${ctaFit.size}px ${FONT_DISPLAY}`;
  ctx.fillText(`👉  ${ctaFit.lines[0]}  ➔`, W / 2, ctaY + ctaH / 2 + 1);

  // Footer / Location
  if (content.location) {
    ctx.fillStyle = "#CBD5E1";
    ctx.font = `700 22px ${FONT_DISPLAY}`;
    const loc = `📍 ${content.location.toUpperCase()}   •   LIMITED TIME ONLY`;
    ctx.fillText(clamp(ctx, loc, W - 140), W / 2, H - 65);
  }
}

/* ==========================================================================
   3. MODERN / MINIMAL VARIATION
   ========================================================================== */
function renderMinimalVariation(
  ctx: CanvasRenderingContext2D,
  content: PosterContent,
  image: HTMLImageElement | null,
) {
  const W = POSTER_W;
  const H = POSTER_H;

  // Ultra-Sleek Studio Charcoal Slate Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0B0F19");
  bg.addColorStop(0.5, "#111827");
  bg.addColorStop(1, "#090D15");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Crisp Swiss structural outer frame
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, 40, 40, W - 80, H - 80, 24);
  ctx.stroke();
  ctx.restore();

  // Top Minimalist Header Grid
  ctx.textBaseline = "middle";

  // Business Name
  ctx.textAlign = "left";
  const nameFit = fitText(ctx, content.businessName.toUpperCase(), FONT_SANS, "800", 36, 24, W - 380, 1);
  setSpacing(ctx, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 ${nameFit.size}px ${FONT_SANS}`;
  ctx.fillText(nameFit.lines[0] || content.businessName, 80, 95);
  resetSpacing(ctx);

  // Right Status Pill
  ctx.textAlign = "right";
  setSpacing(ctx, 1.5);
  ctx.fillStyle = "#60A5FA";
  ctx.font = `700 16px ${FONT_SANS}`;
  ctx.fillText((content.businessType || "LOCAL BUSINESS").toUpperCase(), W - 80, 95);
  resetSpacing(ctx);

  // Separator line
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(80, 130);
  ctx.lineTo(W - 80, 130);
  ctx.stroke();

  // Hero Focal Image Showcase
  const imgX = 72;
  const imgY = 160;
  const imgW = W - 144; // 936
  const imgH = 580;
  const radius = 20;

  if (image) {
    drawCoverClipped(ctx, image, imgX, imgY, imgW, imgH, radius);

    // Subtle dark gradient at bottom of photo
    ctx.save();
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.clip();
    const darkMask = ctx.createLinearGradient(0, imgY + imgH - 140, 0, imgY + imgH);
    darkMask.addColorStop(0, "transparent");
    darkMask.addColorStop(1, "rgba(9, 13, 21, 0.7)");
    ctx.fillStyle = darkMask;
    ctx.fillRect(imgX, imgY, imgW, imgH);
    ctx.restore();

    // Crisp 1.5px border
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 2;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();
    ctx.restore();

    // Clean Minimalist Tag pinned at bottom-left of photo
    const pillW = 220;
    const pillH = 40;
    const pillX = imgX + 24;
    const pillY = imgY + imgH - 64;
    ctx.save();
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    roundRect(ctx, pillX, pillY, pillW, pillH, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, pillX, pillY, pillW, pillH, 8);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#F8FAFC";
    ctx.font = `600 15px ${FONT_SANS}`;
    ctx.fillText("", pillX + pillW / 2, pillY + pillH / 2);
    ctx.restore();
  } else {
    // Swiss Studio architectural card
    ctx.save();
    ctx.fillStyle = "#162032";
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, imgX, imgY, imgW, imgH, radius);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#38BDF8";
    ctx.font = `800 54px ${FONT_SANS}`;
    ctx.fillText("✦", W / 2, imgY + imgH / 2 - 20);

    setSpacing(ctx, 3);
    ctx.fillStyle = "#F1F5F9";
    ctx.font = `700 24px ${FONT_SANS}`;
    ctx.fillText((content.businessType || "LOCAL BUSINESS").toUpperCase(), W / 2, imgY + imgH / 2 + 45);
    resetSpacing(ctx);
    ctx.restore();
  }

  // --- Bottom Editorial Content ---
  ctx.textAlign = "center";
  const bottomY = 775;

  // Minimalist Offer Capsule Tag
  const displayOffer = content.mainOffer || content.headline || "";
  const offerFit = fitText(ctx, displayOffer, FONT_SANS, "800", 60, 32, W - 240, 1);
  const tagW = Math.min(W - 200, ctx.measureText(offerFit.lines[0]).width + 80);
  const tagH = 72;
  const tagX = (W - tagW) / 2;
  const tagY = bottomY;

  ctx.save();
  ctx.fillStyle = "rgba(59, 130, 246, 0.14)";
  roundRect(ctx, tagX, tagY, tagW, tagH, 16);
  ctx.fill();
  ctx.strokeStyle = "rgba(96, 165, 250, 0.6)";
  ctx.lineWidth = 2;
  roundRect(ctx, tagX, tagY, tagW, tagH, 16);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#60A5FA";
  ctx.font = `800 ${offerFit.size}px ${FONT_SANS}`;
  ctx.fillText(offerFit.lines[0], W / 2, tagY + tagH / 2 + 1);

  let currentY = tagY + tagH + 34;
  if (content.priceLine) {
    ctx.fillStyle = "#93C5FD";
    ctx.font = `600 24px ${FONT_SANS}`;
    ctx.fillText(content.priceLine, W / 2, currentY);
    currentY += 38;
  }

  // Headline / Service Title in Contemporary Sans
  const primaryTitle = content.headline || content.service;
  const titleFit = fitText(ctx, primaryTitle, FONT_SANS, "800", 44, 26, W - 180, 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 ${titleFit.size}px ${FONT_SANS}`;
  for (const line of titleFit.lines) {
    ctx.fillText(line, W / 2, currentY);
    currentY += titleFit.size * 1.15;
  }

  // Benefit
  const benefitText = content.subheadline || content.benefit;
  if (benefitText) {
    ctx.fillStyle = "#94A3B8";
    ctx.font = `500 22px ${FONT_SANS}`;
    const benLine = clamp(ctx, `— ${benefitText}`, W - 200);
    ctx.fillText(benLine, W / 2, currentY + 6);
    currentY += 40;
  }

  // Clean Studio CTA Button
  const ctaFit = fitText(ctx, content.cta.toUpperCase(), FONT_SANS, "800", 28, 20, W - 280, 1);
  const ctaBtnW = Math.min(W - 240, Math.max(380, ctx.measureText(ctaFit.lines[0]).width + 120));
  const ctaBtnH = 74;
  const ctaBtnX = (W - ctaBtnW) / 2;
  const ctaBtnY = Math.min(H - 175, Math.max(currentY + 12, 1140));

  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, ctaBtnX, ctaBtnY, ctaBtnW, ctaBtnH, 16);
  ctx.fill();
  ctx.restore();

  setSpacing(ctx, 1.5);
  ctx.fillStyle = "#0B0F19";
  ctx.font = `800 ${ctaFit.size}px ${FONT_SANS}`;
  ctx.fillText(`${ctaFit.lines[0]}  →`, W / 2, ctaBtnY + ctaBtnH / 2 + 1);
  resetSpacing(ctx);

  // Footer / Location
  if (content.location) {
    setSpacing(ctx, 2);
    ctx.fillStyle = "rgba(148, 163, 184, 0.9)";
    ctx.font = `600 20px ${FONT_SANS}`;
    const loc = `LOCATION: ${content.location.toUpperCase()}   •   OPEN 7 DAYS`;
    ctx.fillText(clamp(ctx, loc, W - 140), W / 2, H - 65);
    resetSpacing(ctx);
  }
}

function renderSplitLayout(ctx: CanvasRenderingContext2D, content: PosterContent, image: HTMLImageElement | null) {
  const W = POSTER_W;
  const H = POSTER_H;
  const imageOnLeft = content.layoutType === "SPLIT_LEFT_TEXT_RIGHT_IMAGE";
  const imageW = 410;
  const imageX = imageOnLeft ? 0 : W - imageW;
  const textX = imageOnLeft ? imageW + 54 : 54;
  const textW = W - imageW - 108;
  const accent: Record<NonNullable<PosterContent["colorDirection"]>, string> = {
    WARM_FOOD: "#A94C2F", ENERGETIC: "#C92F4B", REFINED: "#B39458", CALM: "#4F8B7F", FESTIVE: "#B43D32", NEUTRAL: "#586274",
  };
  const color = accent[content.colorDirection ?? "NEUTRAL"];

  ctx.fillStyle = "#F5F0E8";
  ctx.fillRect(0, 0, W, H);
  if (image) {
    drawCoverClipped(ctx, image, imageX, 0, imageW, H, 0);
    ctx.fillStyle = "rgba(14, 20, 30, 0.08)";
    ctx.fillRect(imageX, 0, imageW, H);
  } else {
    const imageBg = ctx.createLinearGradient(imageX, 0, imageX + imageW, H);
    imageBg.addColorStop(0, color);
    imageBg.addColorStop(1, "#222A36");
    ctx.fillStyle = imageBg;
    ctx.fillRect(imageX, 0, imageW, H);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(imageX + imageW / 2, H / 2, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(imageX + imageW / 2, H / 2, 208, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.fillRect(textX, 96, textW, 10);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#6B6258";
  ctx.font = `700 22px ${FONT_SANS}`;
  ctx.fillText(clamp(ctx, content.businessName.toUpperCase(), textW), textX, 138);

  const title = content.headline || content.service;
  const titleFit = fitText(ctx, title, FONT_SERIF, "700", 66, 38, textW, 4);
  ctx.fillStyle = "#1D2631";
  ctx.font = `700 ${titleFit.size}px ${FONT_SERIF}`;
  let y = 280;
  titleFit.lines.forEach((line) => {
    ctx.fillText(line, textX, y);
    y += titleFit.size * 1.12;
  });
  const benefit = content.subheadline || content.benefit;
  if (benefit) {
    y += 20;
    const benefitFit = fitText(ctx, benefit, FONT_SANS, "500", 30, 21, textW, 4);
    ctx.fillStyle = "#5C6269";
    ctx.font = `500 ${benefitFit.size}px ${FONT_SANS}`;
    benefitFit.lines.forEach((line) => {
      ctx.fillText(line, textX, y);
      y += benefitFit.size * 1.3;
    });
  }

  const offerFit = fitText(ctx, content.mainOffer || "", FONT_SANS, "800", 32, 20, textW, 3);
  ctx.fillStyle = color;
  ctx.font = `800 ${offerFit.size}px ${FONT_SANS}`;
  y = Math.max(y + 58, 860);
  offerFit.lines.forEach((line) => {
    ctx.fillText(line, textX, y);
    y += offerFit.size * 1.3;
  });
  const buttonY = Math.min(H - 200, Math.max(y + 65, 1080));
  ctx.fillStyle = "#202A35";
  roundRect(ctx, textX, buttonY, textW, 82, 12);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ctaFit = fitText(ctx, content.cta.toUpperCase(), FONT_SANS, "800", 27, 18, textW - 28, 1);
  ctx.font = `800 ${ctaFit.size}px ${FONT_SANS}`;
  ctx.fillText(ctaFit.lines[0], textX + textW / 2, buttonY + 41);
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#6B6258";
  ctx.font = `600 20px ${FONT_SANS}`;
  ctx.fillText(clamp(ctx, content.location || "", textW), textX, H - 56);
}

/* ==========================================================================
   MAIN DISPATCHER
   ========================================================================== */

export function drawPoster(
  canvas: HTMLCanvasElement,
  content: PosterContent,
  _tone: Tone,
  image: HTMLImageElement | null,
  variation: CreativeVariation = "luxury",
): void {
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, POSTER_W, POSTER_H);
  const renderContent = { ...content, mainOffer: isNoOffer(content.mainOffer) ? "" : content.mainOffer };

  const layoutVariation: Partial<Record<NonNullable<PosterContent["layoutType"]>, CreativeVariation>> = {
    HERO_CENTER: "luxury",
    SPLIT_LEFT_TEXT_RIGHT_IMAGE: "minimal",
    SPLIT_RIGHT_TEXT_LEFT_IMAGE: "bold",
    FULL_BLEED_IMAGE: "bold",
    PRODUCT_FOCUS: "minimal",
    MINIMAL_EDITORIAL: "minimal",
    BOLD_PROMO: "bold",
    DARK_PREMIUM: "luxury",
    CLEAN_BUSINESS: "minimal",
    FESTIVE: "bold",
    SOCIAL_STORY_STYLE: "bold",
  };
  const selectedVariation = renderContent.layoutType ? layoutVariation[renderContent.layoutType] ?? variation : variation;

  if (renderContent.layoutType === "SPLIT_LEFT_TEXT_RIGHT_IMAGE" || renderContent.layoutType === "SPLIT_RIGHT_TEXT_LEFT_IMAGE") {
    renderSplitLayout(ctx, renderContent, image);
    const splitAccent: Record<NonNullable<PosterContent["colorDirection"]>, string> = {
      WARM_FOOD: "#E88345", ENERGETIC: "#E83E58", REFINED: "#C9A765", CALM: "#62A99B", FESTIVE: "#E4A52B", NEUTRAL: "#94A3B8",
    };
    ctx.fillStyle = splitAccent[content.colorDirection ?? "NEUTRAL"];
    ctx.fillRect(0, POSTER_H - 24, POSTER_W, 24);
    return;
  }

  switch (selectedVariation) {
    case "luxury":
      renderLuxuryVariation(ctx, renderContent, image);
      break;
    case "bold":
      renderBoldVariation(ctx, renderContent, image);
      break;
    case "minimal":
      renderMinimalVariation(ctx, renderContent, image);
      break;
    default:
      renderLuxuryVariation(ctx, renderContent, image);
      break;
  }

  const paletteAccent: Record<NonNullable<PosterContent["colorDirection"]>, string> = {
    WARM_FOOD: "#E88345",
    ENERGETIC: "#E83E58",
    REFINED: "#C9A765",
    CALM: "#62A99B",
    FESTIVE: "#E4A52B",
    NEUTRAL: "#94A3B8",
  };
  ctx.fillStyle = paletteAccent[content.colorDirection ?? "NEUTRAL"];
  ctx.fillRect(0, POSTER_H - 24, POSTER_W, 24);
}

export function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "ad";
}

export function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  baseName: string,
  variation: CreativeVariation = "luxury",
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slugify(baseName)}-${variation}-ad.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve(true);
      }, "image/png");
    } catch {
      resolve(false);
    }
  });
}

