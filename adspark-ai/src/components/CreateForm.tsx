import { useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { BUSINESS_TYPES, TONES } from "../types";
import type { AdInput, BusinessType, Tone, VisualMode } from "../types";
import { processImageFile } from "../lib/image";
import type { LoadedImage } from "../lib/image";

export type FormErrors = Partial<Record<"businessName" | "product" | "offer" | "target", string>>;

interface Props {
  value: AdInput;
  onChange: (next: AdInput) => void;
  image: LoadedImage | null;
  onImageChange: (img: LoadedImage | null) => void;
  errors: FormErrors;
  loading: boolean;
  onSubmit: () => void;
}

const inputBase =
  "mt-1.5 block w-full rounded-xl border bg-white px-4 py-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2";

function fieldClass(hasError: boolean) {
  return `${inputBase} ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-200"
      : "border-slate-200 focus:border-indigo-400 focus:ring-indigo-200"
  }`;
}

export function CreateForm({
  value,
  onChange,
  image,
  onImageChange,
  errors,
  loading,
  onSubmit,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");
  const [reading, setReading] = useState(false);

  const visualMode = value.visualMode || (image ? "upload" : "ai");

  function set<K extends keyof AdInput>(key: K, v: AdInput[K]) {
    onChange({ ...value, [key]: v });
  }

  function setVisualMode(mode: VisualMode) {
    onChange({ ...value, visualMode: mode });
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files && e.target.files[0];
    const input = e.target;
    setImageError("");
    if (!file) return;
    setReading(true);
    const result = await processImageFile(file);
    setReading(false);
    if (result.ok) {
      onImageChange(result.image);
      setVisualMode("upload");
    } else {
      setImageError(result.error);
    }
    input.value = "";
  }

  function removeImage() {
    onImageChange(null);
    setImageError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!loading) onSubmit();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/60 sm:p-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Create Your Campaign
          </h2>
          <p className="mt-1 text-slate-500">
            Real AI marketing strategy and copywriter for your local business.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          Real AI Engine
        </span>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="businessName" className="text-sm font-semibold text-slate-700">
            Business Name
          </label>
          <input
            id="businessName"
            type="text"
            maxLength={80}
            value={value.businessName}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("businessName", e.target.value)}
            placeholder="e.g. Fitness Point Gym / Glow Salon"
            className={fieldClass(!!errors.businessName)}
            aria-invalid={!!errors.businessName}
            aria-describedby={errors.businessName ? "businessName-err" : undefined}
          />
          {errors.businessName && (
            <p id="businessName-err" className="mt-1.5 text-sm text-red-600">
              {errors.businessName}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="businessType" className="text-sm font-semibold text-slate-700">
            Business Category
          </label>
          <select
            id="businessType"
            value={value.businessType}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => set("businessType", e.target.value as BusinessType)}
            className={fieldClass(false)}
          >
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="product" className="text-sm font-semibold text-slate-700">
            Product / Service
          </label>
          <input
            id="product"
            type="text"
            maxLength={120}
            value={value.product}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("product", e.target.value)}
            placeholder="e.g. Body building, weight loss / Hair Spa"
            className={fieldClass(!!errors.product)}
            aria-invalid={!!errors.product}
            aria-describedby={errors.product ? "product-err" : undefined}
          />
          <p className="mt-1 text-xs text-slate-400">
            Rough notes are fine — the AI copywriter will polish and strategize your offer.
          </p>
          {errors.product && (
            <p id="product-err" className="mt-1.5 text-sm text-red-600">
              {errors.product}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="offer" className="text-sm font-semibold text-slate-700">
            Price / Offer
          </label>
          <input
            id="offer"
            type="text"
            maxLength={80}
            value={value.offer}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("offer", e.target.value)}
            placeholder="e.g. ₹1,499/mo — 30% OFF or ₹999"
            className={fieldClass(!!errors.offer)}
            aria-invalid={!!errors.offer}
            aria-describedby={errors.offer ? "offer-err" : undefined}
          />
          <p className="mt-1 text-xs text-slate-400">
            Your real price/discount will be preserved exactly.
          </p>
          {errors.offer && (
            <p id="offer-err" className="mt-1.5 text-sm text-red-600">
              {errors.offer}
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="target" className="text-sm font-semibold text-slate-700">
            Target Customer & Location <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="target"
            type="text"
            maxLength={120}
            value={value.target}
            onChange={(e: ChangeEvent<HTMLInputElement>) => set("target", e.target.value)}
            placeholder="e.g. Men & women aged 20–50 in Hyderabad"
            className={fieldClass(!!errors.target)}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="campaignBrief" className="text-sm font-semibold text-slate-700">
            Campaign idea or occasion <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id="campaignBrief"
            rows={2}
            maxLength={500}
            value={value.campaignBrief || ""}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => set("campaignBrief", e.target.value)}
            placeholder="e.g. launch, festival, goal, preferred style or brand colors"
            className={fieldClass(false)}
          />
        </div>

        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold text-slate-700">Brand Tone</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONES.map((t) => {
              const active = value.tone === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("tone", t as Tone)}
                  aria-pressed={active}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    active
                      ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Visual Selection Mode */}
        <div className="sm:col-span-2">
          <label className="text-sm font-semibold text-slate-700">
            Ad Visual Source
          </label>
          
          <div className="mt-2 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setVisualMode("ai")}
              className={`flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                visualMode === "ai"
                  ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-2 ring-indigo-600"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-2xl">✨</span>
              <span className="mt-1 font-bold text-sm">Generate AI Visual</span>
              <span className="text-xs text-slate-500">
                Photorealistic advertising scene tailored to your business
              </span>
            </button>

            <button
              type="button"
              onClick={() => setVisualMode("upload")}
              className={`flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                visualMode === "upload"
                  ? "border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-2 ring-indigo-600"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="text-2xl">🖼️</span>
              <span className="mt-1 font-bold text-sm">Upload My Image</span>
              <span className="text-xs text-slate-500">
                Use your real product or store photography
              </span>
            </button>
          </div>

          {/* Conditional Upload Box */}
          {visualMode === "upload" && (
            <div className="mt-4">
              <input
                ref={fileRef}
                id="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={onFile}
                className="sr-only"
              />
              {image ? (
                <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <img
                    src={image.dataUrl}
                    alt="Uploaded product preview"
                    className="h-20 w-20 rounded-xl object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{image.name}</p>
                    <p className="text-xs text-slate-500">This photo will be the focal point of all 3 ad concepts.</p>
                  </div>
                  <button
                    type="button"
                    onClick={removeImage}
                    className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="image"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center transition hover:border-indigo-400 hover:bg-indigo-50/40 focus-within:ring-2"
                >
                  <span className="text-2xl" aria-hidden="true">
                    📁
                  </span>
                  <span className="mt-1 text-sm font-semibold text-slate-700">
                    {reading ? "Reading image…" : "Select Photo from Device"}
                  </span>
                  <span className="text-xs text-slate-500">JPG, PNG or WEBP up to 8 MB</span>
                </label>
              )}
              {imageError && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {imageError}
                </p>
              )}
            </div>
          )}

          {visualMode === "ai" && (
            <div className="mt-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-xs text-indigo-900">
              <span className="font-bold">✨ AI Visual Mode:</span> The AI copywriter will synthesize an advertising visual prompt with clean vertical 4:5 negative space, and the image model will generate a high-end commercial visual without messy AI lettering.
            </div>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden="true"
            />
            Crafting Campaign…
          </>
        ) : (
          "✨ Generate My Ad Campaign"
        )}
      </button>

      {Object.keys(errors).length > 0 && (
        <p role="alert" className="mt-3 text-center text-sm text-red-600">
          Please fix the highlighted fields and try again.
        </p>
      )}
    </form>
  );
}
