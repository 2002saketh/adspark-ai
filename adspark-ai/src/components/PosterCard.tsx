import { useEffect, useRef, useState } from "react";
import { downloadCanvasAsPng, drawPoster, POSTER_H, POSTER_W } from "../lib/poster";
import { loadImageElement } from "../lib/image";
import type { LoadedImage } from "../lib/image";
import { CREATIVE_VARIATIONS } from "../types";
import type { AdConcept, AdInput, CreativeVariation, PosterContent } from "../types";
import { generateVisualForConcept, regenerateRealConcept } from "../services/aiService";

interface Props {
  concepts: AdConcept[];
  input: AdInput;
  userImage: LoadedImage | null;
  onConceptUpdated: (updatedConcept: AdConcept) => void;
}

export function PosterCard({ concepts, input, userImage, onConceptUpdated }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeVariation, setActiveVariation] = useState<CreativeVariation>("luxury");
  const [message, setMessage] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const [generatingVisual, setGeneratingVisual] = useState(false);
  const [regeneratingCopy, setRegeneratingCopy] = useState(false);
  const [loadedAiImages, setLoadedAiImages] = useState<Record<string, HTMLImageElement>>({});

  const currentIndex = CREATIVE_VARIATIONS.findIndex((v) => v.id === activeVariation);
  const currentOption = CREATIVE_VARIATIONS[currentIndex] ?? CREATIVE_VARIATIONS[0];
  const currentConcept =
    concepts.find((c) => c.variationId === activeVariation) ?? concepts[0] ?? ({} as Partial<AdConcept>);

  // Pre-load AI image if present for current concept
  useEffect(() => {
    let cancelled = false;
    const aiUrl = currentConcept.aiImageUrl;
    if (aiUrl && !loadedAiImages[aiUrl]) {
      loadImageElement(aiUrl)
        .then((img) => {
          if (!cancelled) {
            setLoadedAiImages((prev) => ({ ...prev, [aiUrl]: img }));
          }
        })
        .catch(() => {
          // ignore error
        });
    }
    return () => {
      cancelled = true;
    };
  }, [currentConcept.aiImageUrl, loadedAiImages]);

  // Render poster canvas whenever active concept, image or typography changes
  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      } catch {
        // ignore
      }
      if (cancelled || !canvasRef.current) return;

      const posterContent: PosterContent = {
        businessName: input.businessName,
        mainOffer: currentConcept.offer || input.offer,
        priceLine: "",
        service: currentConcept.headline || input.product,
        benefit: currentConcept.subheadline || currentConcept.benefit || "",
        cta: currentConcept.cta || "BOOK NOW",
        location: input.target ? input.target.replace(/^.*(?:in|at|near)\s+/i, "") : "",
        businessType: input.businessType,
        headline: currentConcept.headline,
        subheadline: currentConcept.subheadline,
        layoutType: currentConcept.layoutType,
        colorDirection: currentConcept.colorDirection,
      };

      // Priority: 1. User uploaded image, 2. Loaded AI-generated visual, 3. Null (geometric graphic)
      let activeImageEl: HTMLImageElement | null = null;
      if (userImage) {
        activeImageEl = userImage.element;
      } else if (currentConcept.aiImageUrl && loadedAiImages[currentConcept.aiImageUrl]) {
        activeImageEl = loadedAiImages[currentConcept.aiImageUrl];
      }

      try {
        drawPoster(canvasRef.current, posterContent, input.tone, activeImageEl, activeVariation);
      } catch {
        try {
          if (canvasRef.current) {
            drawPoster(canvasRef.current, posterContent, input.tone, null, activeVariation);
          }
        } catch {
          setMessage("We couldn't render the canvas in this browser.");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, [activeVariation, currentConcept, input, userImage, loadedAiImages]);

  function handlePrev() {
    const nextIdx = (currentIndex - 1 + CREATIVE_VARIATIONS.length) % CREATIVE_VARIATIONS.length;
    setActiveVariation(CREATIVE_VARIATIONS[nextIdx].id);
  }

  function handleNext() {
    const nextIdx = (currentIndex + 1) % CREATIVE_VARIATIONS.length;
    setActiveVariation(CREATIVE_VARIATIONS[nextIdx].id);
  }

  async function onDownloadCurrent() {
    if (!canvasRef.current || downloading) return;
    setDownloading(true);
    const ok = await downloadCanvasAsPng(canvasRef.current, input.businessName, activeVariation);
    setDownloading(false);
    setMessage(
      ok
        ? `Downloaded ${currentOption.title} creative (1080×1350 PNG).`
        : "Download failed — try right-clicking the canvas and choosing 'Save Image As'.",
    );
    window.setTimeout(() => setMessage(""), 4000);
  }

  async function onDownloadAll() {
    if (downloading) return;
    setDownloading(true);
    const offscreen = document.createElement("canvas");
    offscreen.width = POSTER_W;
    offscreen.height = POSTER_H;

    let count = 0;
    for (const opt of CREATIVE_VARIATIONS) {
      const concept = concepts.find((c) => c.variationId === opt.id) ?? currentConcept;
      const content: PosterContent = {
        businessName: input.businessName,
        mainOffer: concept.offer || input.offer,
        priceLine: "",
        service: concept.headline || input.product,
        benefit: concept.subheadline || concept.benefit || "",
        cta: concept.cta || "BOOK NOW",
        location: input.target ? input.target.replace(/^.*(?:in|at|near)\s+/i, "") : "",
        businessType: input.businessType,
        headline: concept.headline,
        subheadline: concept.subheadline,
        layoutType: concept.layoutType,
        colorDirection: concept.colorDirection,
      };

      let imgEl: HTMLImageElement | null = null;
      if (userImage) {
        imgEl = userImage.element;
      } else if (concept.aiImageUrl && loadedAiImages[concept.aiImageUrl]) {
        imgEl = loadedAiImages[concept.aiImageUrl];
      }

      drawPoster(offscreen, content, input.tone, imgEl, opt.id);
      const ok = await downloadCanvasAsPng(offscreen, input.businessName, opt.id);
      if (ok) count++;
      await new Promise((r) => setTimeout(r, 400));
    }
    setDownloading(false);
    setMessage(`Successfully downloaded all ${count} creative concepts!`);
    window.setTimeout(() => setMessage(""), 4500);
  }

  async function handleGenerateVisual() {
    if (generatingVisual || !currentConcept.visualPrompt) return;
    setGeneratingVisual(true);
    setMessage("Generating photorealistic commercial visual…");
    try {
      const res = await generateVisualForConcept(
        currentConcept.visualPrompt,
        input.businessName,
        activeVariation,
        currentConcept.designDirection,
      );
      if (res?.imageUrl) {
        const imgEl = await loadImageElement(res.imageUrl);
        setLoadedAiImages((prev) => ({ ...prev, [res.imageUrl]: imgEl }));
        onConceptUpdated({
          ...currentConcept,
          aiImageUrl: res.imageUrl,
          imageModel: res.imageModel,
          imageGenerationMs: res.generationMs,
          visualSource: res.visualSource,
        } as AdConcept);
        setMessage("AI visual generated and placed on poster!");
      }
    } catch (err: any) {
      setMessage(err.message || "Could not generate AI visual.");
    } finally {
      setGeneratingVisual(false);
      window.setTimeout(() => setMessage(""), 5000);
    }
  }

  async function handleRegenerateCopy() {
    if (regeneratingCopy) return;
    setRegeneratingCopy(true);
    setMessage("AI Copywriter is strategizing a brand new angle…");
    try {
      const updated = await regenerateRealConcept(input, activeVariation, userImage !== null);
      if (updated) {
        onConceptUpdated(updated);
        setMessage(`New ${currentOption.title} concept generated!`);
      }
    } catch (err: any) {
      setMessage(err.message || "Failed to regenerate concept.");
    } finally {
      setRegeneratingCopy(false);
      window.setTimeout(() => setMessage(""), 4500);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6">
      {/* Variation Header & Tabs */}
      <div className="w-full">
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <div>
            <h3 className="text-xl font-bold text-slate-900">3 AI Creative Concepts</h3>
            <p className="text-xs text-slate-500">
              Strategized by Real AI Copywriter & Visual Director
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">
            Concept {currentIndex + 1} of {CREATIVE_VARIATIONS.length}
          </span>
        </div>

        {/* Carousel Style Switcher Tabs */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {CREATIVE_VARIATIONS.map((v) => {
            const active = activeVariation === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActiveVariation(v.id)}
                className={`flex flex-col items-center rounded-2xl p-3 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? "bg-slate-900 text-white shadow-md ring-2 ring-slate-900"
                    : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <span className="text-xs font-extrabold uppercase tracking-wide">
                  {v.badge}
                </span>
                <span className={`mt-0.5 text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                  {v.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Canvas & Carousel Controls */}
      <div className="relative w-full max-w-lg">
        {/* Navigation Arrow Left */}
        <button
          type="button"
          onClick={handlePrev}
          aria-label="Previous ad creative"
          className="absolute -left-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:-left-6"
        >
          <span className="text-lg font-bold">←</span>
        </button>

        {/* Navigation Arrow Right */}
        <button
          type="button"
          onClick={handleNext}
          aria-label="Next ad creative"
          className="absolute -right-4 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg backdrop-blur transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:-right-6"
        >
          <span className="text-lg font-bold">→</span>
        </button>

        {/* The Live Render Canvas */}
        <div className="overflow-hidden rounded-3xl shadow-2xl ring-1 ring-slate-200/80">
          <canvas
            ref={canvasRef}
            width={POSTER_W}
            height={POSTER_H}
            role="img"
            aria-label={`${currentOption.title} promotional advertisement for ${input.businessName}`}
            className="h-auto w-full"
          />
        </div>

        {/* Carousel Indicator Dots */}
        <div className="mt-3 flex justify-center gap-2">
          {CREATIVE_VARIATIONS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setActiveVariation(v.id)}
              aria-label={`Switch to ${v.title}`}
              className={`h-2.5 rounded-full transition-all ${
                activeVariation === v.id ? "w-8 bg-slate-900" : "w-2.5 bg-slate-300 hover:bg-slate-400"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Concept Copy & Marketing Direction Card */}
      <div className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200/80 pb-3">
          <div>
            <span className="text-xs font-bold text-indigo-700 uppercase tracking-wider">
              {currentOption.title} Strategy
            </span>
            <h4 className="mt-0.5 text-base font-extrabold text-slate-900">
              "{currentConcept.headline}"
            </h4>
            <p className="text-xs text-slate-600 italic">
              {currentConcept.subheadline}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRegenerateCopy}
            disabled={regeneratingCopy}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60"
          >
            {regeneratingCopy ? "Thinking…" : "↻ Regenerate Copy"}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl bg-white p-2.5 border border-slate-200/60">
            <span className="font-bold text-slate-500 block uppercase">Core Benefit</span>
            <span className="text-slate-800 font-medium">{currentConcept.benefit}</span>
          </div>
          <div className="rounded-xl bg-white p-2.5 border border-slate-200/60">
            <span className="font-bold text-slate-500 block uppercase">Preserved Offer</span>
            <span className="text-slate-800 font-medium">{currentConcept.offer}</span>
          </div>
        </div>

        {/* AI Visual Action if in AI mode and no user image */}
        {!userImage && (
          <div className="mt-3 flex items-center justify-between rounded-xl bg-indigo-50/60 p-3 border border-indigo-100">
            <div className="min-w-0 flex-1 pr-3">
              <span className="text-xs font-bold text-indigo-900 block">
                {currentConcept.visualSource === "CUSTOM_AI_VISUAL" && currentConcept.aiImageUrl
                  ? "✨ Custom AI visual"
                  : currentConcept.visualSource === "TEMPLATE_FALLBACK"
                    ? "Poster layout fallback (image unavailable)"
                    : "✨ Commercial AI Visual"}
              </span>
              <span className="text-xs text-indigo-700 line-clamp-1">
                {currentConcept.visualPrompt}
              </span>
            </div>
            <button
              type="button"
              onClick={handleGenerateVisual}
              disabled={generatingVisual}
              className="shrink-0 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {generatingVisual ? "Generating Image…" : currentConcept.aiImageUrl ? "↻ New Visual" : "✨ Generate Visual"}
            </button>
          </div>
        )}
      </div>

      {/* Download Action Buttons */}
      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onDownloadCurrent}
          disabled={downloading}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {downloading ? "Processing…" : `⬇ Download ${currentOption.title} (PNG)`}
        </button>

        <button
          type="button"
          onClick={onDownloadAll}
          disabled={downloading}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-70"
        >
          📦 Download All 3 Ads
        </button>
      </div>

      {/* Status Message */}
      <p className="h-5 text-center text-xs font-medium text-slate-500" aria-live="polite">
        {message || "Standard 1080 × 1350 High-Res PNG (4:5 Aspect Ratio) ready for Instagram & Facebook."}
      </p>
    </div>
  );
}
