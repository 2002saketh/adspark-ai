import { useState } from "react";
import { CopyButton } from "./CopyButton";
import { PosterCard } from "./PosterCard";
import type { LoadedImage } from "../lib/image";
import type { AdCampaign, AdConcept, AdInput, CreativeVariation } from "../types";
import { CREATIVE_VARIATIONS } from "../types";

type TabId = "poster" | "instagram" | "whatsapp" | "adCopy" | "artDirection";

const TABS: { id: TabId; label: string }[] = [
  { id: "poster", label: "🎨 Ad Creatives" },
  { id: "instagram", label: "📱 Instagram Caption" },
  { id: "whatsapp", label: "💬 WhatsApp Message" },
  { id: "adCopy", label: "📈 Google / Meta Ad Copy" },
  { id: "artDirection", label: "✨ Visual Art Direction" },
];

interface Props {
  campaign: AdCampaign;
  input: AdInput;
  image: LoadedImage | null;
  onConceptUpdated: (updated: AdConcept) => void;
}

export function Results({ campaign, input, image, onConceptUpdated }: Props) {
  const [tab, setTab] = useState<TabId>("poster");
  const [selectedConceptVar, setSelectedConceptVar] = useState<CreativeVariation>("luxury");

  const currentConcept =
    campaign.concepts.find((c) => c.variationId === selectedConceptVar) ??
    campaign.concepts[0] ??
    ({} as AdConcept);

  return (
    <div>
      {/* Header & Strategic Analysis */}
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3.5 py-1 text-xs font-bold text-indigo-700">
          ✨ Real AI Marketing Campaign
        </span>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          Marketing Strategy for {input.businessName}
        </h2>
        <p className="mt-2 text-sm text-slate-500 max-w-xl mx-auto">
          AI copywriter synthesized your business offer into 3 commercial campaign angles.
        </p>
      </div>

      {/* Strategic Summary Bar */}
      {campaign.analysis && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-center">
            <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Core Offering
            </span>
            <span className="mt-1 block text-sm font-semibold text-slate-800 line-clamp-1">
              {campaign.analysis.businessCore}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-center">
            <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Target Customer
            </span>
            <span className="mt-1 block text-sm font-semibold text-slate-800 line-clamp-1">
              {campaign.analysis.targetAudience}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-center">
            <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Strongest Benefit
            </span>
            <span className="mt-1 block text-sm font-semibold text-slate-800 line-clamp-1">
              {campaign.analysis.strongestBenefit}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-3.5 text-center">
            <span className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Selling Angle
            </span>
            <span className="mt-1 block text-sm font-semibold text-slate-800 line-clamp-1">
              {campaign.analysis.sellingAngle}
            </span>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Marketing pack sections"
        className="mt-8 flex flex-wrap justify-center gap-2"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-2 text-xs font-bold transition sm:px-4 sm:text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                active
                  ? "bg-slate-900 text-white shadow"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div className="mt-6" role="tabpanel">
        {tab === "poster" && (
          <PosterCard
            concepts={campaign.concepts}
            input={input}
            userImage={image}
            onConceptUpdated={onConceptUpdated}
          />
        )}

        {tab !== "poster" && (
          <div className="space-y-6">
            {/* Concept Sub-Selector for Copy Tabs */}
            <div className="flex items-center justify-center gap-2">
              <span className="text-xs font-semibold text-slate-500">Angle:</span>
              {CREATIVE_VARIATIONS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedConceptVar(v.id)}
                  className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                    selectedConceptVar === v.id
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {v.badge} {v.title}
                </button>
              ))}
            </div>

            {tab === "instagram" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Instagram Caption</h3>
                    <p className="text-xs text-slate-500">
                      Optimized hook, value proposition, CTA and hashtags for {currentConcept.conceptName}.
                    </p>
                  </div>
                  <CopyButton text={currentConcept.caption} />
                </div>
                <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">
                  {currentConcept.caption}
                </pre>
              </div>
            )}

            {tab === "whatsapp" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">WhatsApp Broadcast / Direct Message</h3>
                    <p className="text-xs text-slate-500">
                      Conversational, warm message with clear offer and booking call to action.
                    </p>
                  </div>
                  <CopyButton text={currentConcept.whatsappMessage} />
                </div>
                <pre className="mt-4 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">
                  {currentConcept.whatsappMessage}
                </pre>
              </div>
            )}

            {tab === "adCopy" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Google / Meta Paid Ad Copy</h3>
                    <p className="text-xs text-slate-500">
                      High-conversion copy designed for paid search and social ads.
                    </p>
                  </div>
                  <CopyButton text={currentConcept.shortAdCopy} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                    <span className="text-xs font-bold text-slate-500 uppercase block">Headline</span>
                    <span className="text-sm font-bold text-slate-900">{currentConcept.headline}</span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-200">
                    <span className="text-xs font-bold text-slate-500 uppercase block">Subheadline</span>
                    <span className="text-sm font-medium text-slate-800">{currentConcept.subheadline}</span>
                  </div>
                </div>

                <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">
                  {currentConcept.shortAdCopy}
                </pre>
              </div>
            )}

            {tab === "artDirection" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Visual Art Direction & Photography Prompt</h3>
                    <p className="text-xs text-slate-500">
                      Crafted by AI for commercial image generation with 4:5 vertical framing and typography negative space.
                    </p>
                  </div>
                  <CopyButton text={currentConcept.visualPrompt} />
                </div>

                <div className="rounded-xl bg-indigo-50/50 p-4 border border-indigo-100 text-sm text-indigo-900">
                  <span className="font-bold block">Art Direction Rationale:</span>
                  <span className="mt-1 block text-xs text-indigo-800">{currentConcept.designDirection}</span>
                </div>

                <div className="rounded-xl bg-slate-50 p-4 border border-slate-200">
                  <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Image Generation Prompt</span>
                  <p className="text-sm font-mono text-slate-800 leading-relaxed">{currentConcept.visualPrompt}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
