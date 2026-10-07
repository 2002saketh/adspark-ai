import { useCallback, useEffect, useRef, useState } from "react";
import { CreateForm } from "./components/CreateForm";
import type { FormErrors } from "./components/CreateForm";
import { GoogleSignInButton } from "./components/GoogleSignInButton";
import { Results } from "./components/Results";
import { generateRealAdCampaign } from "./services/aiService";
import { DEMO_INPUT } from "./types";
import type { AdCampaign, AdConcept, AdInput } from "./types";
import type { LoadedImage } from "./lib/image";

interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  picture: string;
}

type PlanId = "free" | "starter" | "pro" | "business";
type Currency = "INR" | "USD";
interface BillingStatus {
  plan: PlanId;
  currency: Currency;
  status: string;
  periodStart: string;
  periodEnd: string;
  adsAllowed: number;
  adsUsed: number;
  adsRemaining: number;
}
interface PlanPricing { ads: number; prices: Record<Currency, number> }

const PLAN_DETAILS: Record<PlanId, { name: string; features: string[]; button: string }> = {
  free: { name: "Free", button: "Current Plan", features: ["3 AI ads per billing period", "AI-generated ad copy", "Professional ad poster", "Instagram caption", "WhatsApp marketing message", "Download generated ad"] },
  starter: { name: "Starter", button: "Get Starter", features: ["20 AI ads per billing period", "Everything in Free", "No watermark", "Multiple creative styles", "Download generated campaigns"] },
  pro: { name: "Pro", button: "Get Pro", features: ["45 AI ads per billing period", "Everything in Starter", "Premium creative styles", "Priority generation", "Designed for active businesses"] },
  business: { name: "Business", button: "Get Business", features: ["108 AI ads per billing period", "Everything in Pro", "High-volume campaign creation", "Multiple campaigns", "Designed for agencies and growing businesses"] },
};

function formatBillingDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function validate(input: AdInput): FormErrors {
  const errors: FormErrors = {};
  if (!input.businessName.trim()) errors.businessName = "Please enter your business name.";
  if (!input.product.trim()) errors.product = "Please tell us what you're promoting.";
  if (!input.offer.trim()) errors.offer = "Please add a price or offer, like ₹999 or 20% OFF.";
  return errors;
}

function cleanInput(input: AdInput): AdInput {
  const t = (s: string) => s.replace(/\s+/g, " ").trim();
  return {
    ...input,
    businessName: t(input.businessName),
    product: t(input.product),
    offer: t(input.offer),
    target: t(input.target),
  };
}

const GENERATION_STEPS = [
  "Creating your campaign...",
  "Designing your visual concepts...",
  "Rendering exact offer and CTA text...",
  "Finishing your advertisement...",
];

const BENEFITS = [
  { icon: "⚡", title: "Real AI Strategist", text: "Turns rough notes into professional high-converting ad campaigns." },
  { icon: "🎨", title: "3 Creative Concepts", text: "Get Luxury, Bold Promotional, and Minimal Modern directions." },
  {
    icon: "📸",
    title: "AI Visual or User Photos",
    text: "Generate photorealistic advertising visuals or showcase your actual product photography.",
  },
];

const STEPS = [
  { n: "1", title: "Enter your offer details", text: "Add your business, offer, and target customer." },
  { n: "2", title: "Choose visual mode", text: "Generate commercial AI visuals or upload your real product image." },
  { n: "3", title: "Click Generate", text: "Get 3 complete creative concepts, posters, captions, and ad copy." },
];

export default function App() {
  const [input, setInput] = useState<AdInput>(DEMO_INPUT);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [genError, setGenError] = useState("");
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);

  const [campaign, setCampaign] = useState<AdCampaign | null>(null);
  const [campaignInput, setCampaignInput] = useState<AdInput | null>(null);
  const [campaignImage, setCampaignImage] = useState<LoadedImage | null>(null);
  const [resultKey, setResultKey] = useState(0);
  const [googleClientId, setGoogleClientId] = useState("");
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [currency, setCurrency] = useState<Currency>("INR");
  const [plans, setPlans] = useState<Record<PlanId, PlanPricing> | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [paymentMessage, setPaymentMessage] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState<PlanId | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/auth/config", { credentials: "same-origin" }).then((response) => response.json()),
      fetch("/api/auth/me", { credentials: "same-origin" }).then((response) => response.json()),
    ]).then(([config, session]) => {
      if (!active) return;
      setGoogleClientId(config.clientId || "");
      setAuthUser(session.authenticated ? session.user : null);
      setAuthReady(true);
    }).catch(() => {
      if (!active) return;
      setAuthReady(true);
      setAuthMessage("Could not connect to the sign-in service. Refresh the page to try again.");
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    fetch("/api/billing/plans").then((r) => r.json()).then((data) => setPlans(data.plans)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!authUser) { setBilling(null); return; }
    fetch("/api/billing/status", { credentials: "same-origin" }).then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setBilling(data); }).catch(() => {});
  }, [authUser]);

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setAuthMessage("");
    try {
      const response = await fetch("/api/auth/google", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Google sign-in failed.");
      setAuthUser(result.user);
      setGenError("");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
    }
  }, []);

  const handleGoogleLoadError = useCallback(() => {
    setAuthMessage("Google sign-in could not load. Check your internet connection and try again.");
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthMessage("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Sign out failed. Please try again.");
      setAuthUser(null);
      setBilling(null);
      window.google?.accounts.id.disableAutoSelect();
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "Sign out failed. Please try again.");
    }
  }, []);

  async function handleChoosePlan(plan: PlanId) {
    if (plan === "free") return;
    if (!authUser) {
      setAuthMessage("Please sign in with Google before choosing a paid plan.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!window.Razorpay) {
      setPaymentMessage("Razorpay Checkout could not load. Check your connection and try again.");
      return;
    }
    setPaymentMessage("");
    setCheckoutLoading(plan);
    try {
      const response = await fetch("/api/payments/create-order", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, currency }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start checkout.");
      const razorpay = new window.Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency,
        name: "AdSpark AI",
        description: `${PLAN_DETAILS[plan].name} plan — per billing period`,
        order_id: result.orderId,
        prefill: { name: authUser.name, email: authUser.email },
        theme: { color: "#4f46e5" },
        handler: (payment) => {
          void (async () => {
            const verification = await fetch("/api/payments/verify", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: result.orderId, ...payment }),
            });
            const verified = await verification.json();
            if (!verification.ok) throw new Error(verified.error || "Payment could not be verified.");
            const activatedBilling = verified.billing as BillingStatus | undefined;
            if (activatedBilling) setBilling(activatedBilling);
            if (verified.status === "success" && activatedBilling) setPaymentMessage(`Payment successful. Your ${PLAN_DETAILS[activatedBilling.plan].name} plan is active with ${activatedBilling.adsRemaining} AI ads available this billing period.`);
            else setPaymentMessage("Payment is still being verified. Your plan will update after Razorpay confirms the captured payment.");
          })().catch((error) => setPaymentMessage(error instanceof Error ? error.message : "Payment could not be verified."));
        },
        modal: { ondismiss: () => setPaymentMessage("Payment was not completed. Your plan has not changed.") },
      });
      razorpay.on("payment.failed", (failure) => {
        const paymentId = failure.error?.metadata?.payment_id;
        void (async () => {
          if (paymentId) {
            await fetch("/api/payments/failure", {
              method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: result.orderId, paymentId }),
            });
          }
          setPaymentMessage("Payment was not completed. Your plan has not changed.");
        })();
      });
      setCheckoutLoading(null);
      razorpay.open();
    } catch (error) {
      setPaymentMessage(error instanceof Error ? error.message : "Could not start checkout.");
      setCheckoutLoading(null);
    }
  }

  // Stepped loading messages
  useEffect(() => {
    if (!loading) {
      setLoadingStepIdx(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStepIdx((prev) => (prev + 1) % GENERATION_STEPS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [loading]);

  // Smooth scroll to results after fresh generation
  useEffect(() => {
    if (resultKey > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [resultKey]);

  async function handleGenerate() {
    if (loading) return;
    if (!authUser) {
      setGenError("Please sign in with Google to generate your campaign.");
      return;
    }
    const cleaned = cleanInput(input);
    const found = validate(cleaned);
    setErrors(found);
    setGenError("");
    if (Object.keys(found).length > 0) return;

    setLoading(true);
    try {
      const result = await generateRealAdCampaign(cleaned, cleaned.visualMode === "upload" && image !== null);
      setCampaign(result);
      setCampaignInput(cleaned);
      setCampaignImage(cleaned.visualMode === "upload" ? image : null);
      setResultKey((k) => k + 1);
    } catch (err: any) {
      setGenError(
        err.message ||
          "Could not generate campaign. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleConceptUpdated(updated: AdConcept) {
    if (!campaign) return;
    const nextConcepts = campaign.concepts.map((c) =>
      c.variationId === updated.variationId ? updated : c,
    );
    setCampaign({ ...campaign, concepts: nextConcepts });
  }

  const showErrorsCleared = (next: AdInput) => {
    setInput(next);
    if (Object.keys(errors).length > 0) setErrors(validate(cleanInput(next)));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6">
          <a href="#top" className="flex shrink-0 items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-lg text-white shadow-sm">
              ✨
            </span>
            <span className="leading-tight">
              <span className="block whitespace-nowrap text-lg font-extrabold tracking-tight">AdSpark AI</span>
              <span className="hidden text-xs text-slate-500 md:block">
                Real AI advertising copywriter and social media ad generator.
              </span>
            </span>
          </a>
          <nav className="flex items-center text-xs font-semibold text-slate-600 sm:gap-1 sm:text-sm" aria-label="Main">
            <a href="#create" className="whitespace-nowrap rounded-lg px-2 py-2 hover:bg-slate-100 sm:px-3">
              Create Ad
            </a>
            <a href="#how-it-works" className="whitespace-nowrap rounded-lg px-2 py-2 hover:bg-slate-100 sm:px-3">
              How It Works
            </a>
            <a href="#pricing" className="whitespace-nowrap rounded-lg px-2 py-2 hover:bg-slate-100 sm:px-3">
              Pricing
            </a>
            <div className="ml-2 flex min-h-10 items-center gap-2 border-l border-slate-200 pl-3">
              {!authReady ? (
                <span className="whitespace-nowrap text-xs text-slate-500">Checking sign-in…</span>
              ) : authUser ? (
                <>
                  {authUser.picture && (
                    <img
                      src={authUser.picture}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="h-8 w-8 rounded-full border border-slate-200 object-cover"
                    />
                  )}
                  <span className="hidden max-w-28 truncate text-sm font-semibold text-slate-700 sm:inline">
                    {authUser.name}
                  </span>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:text-sm"
                  >
                    Sign out
                  </button>
                </>
              ) : googleClientId ? (
                <GoogleSignInButton
                  clientId={googleClientId}
                  onCredential={handleGoogleCredential}
                  onLoadError={handleGoogleLoadError}
                />
              ) : (
                <div className="text-right">
                  <button
                    type="button"
                    disabled
                    className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 sm:text-sm"
                  >
                    Sign in with Google
                  </button>
                  <span className="mt-1 block text-[10px] text-slate-500">Set GOOGLE_CLIENT_ID in .env</span>
                </div>
              )}
            </div>
          </nav>
        </div>
        {authMessage && (
          <p role="status" className="mx-auto max-w-6xl px-4 pb-2 text-right text-xs text-amber-800 sm:px-6">
            {authMessage}
          </p>
        )}
      </header>

      {authUser && billing && (
        <section aria-label="Account usage" className="border-b border-indigo-100 bg-indigo-50/70 px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-extrabold uppercase tracking-wide text-indigo-900">{PLAN_DETAILS[billing.plan].name}</span>
              <span className="ml-3 text-slate-700">{billing.adsUsed} / {billing.adsAllowed} ads used</span>
              <span className="ml-3 font-semibold text-indigo-800">{billing.adsRemaining} ads remaining</span>
            </div>
            <p className="text-slate-600">Billing period: {formatBillingDate(billing.periodStart)} – {formatBillingDate(billing.periodEnd)} · Resets on {formatBillingDate(billing.periodEnd)}</p>
          </div>
        </section>
      )}

      <main id="top">
        {/* Hero */}
        <section className="relative overflow-hidden bg-white">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-indigo-50 to-transparent"
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-4xl px-4 pb-14 pt-14 text-center sm:px-6 sm:pt-20">
            <span className="inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-sm font-semibold text-indigo-700">
              ⚡ Powered by Real AI Copywriting & Visual Intelligence
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
              Turn Rough Business Notes Into High-Converting Ads
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600 sm:text-xl">
              Real AI strategizes your value proposition, writes professional marketing copy, and creates 3 distinct commercial ad creatives.
            </p>
            <a
              href="#create"
              className="mt-8 inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Start My Campaign
            </a>
          </div>

          <div className="relative mx-auto grid max-w-6xl gap-5 px-4 pb-16 sm:px-6 md:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-xl" aria-hidden="true">
                  {b.icon}
                </div>
                <h3 className="mt-4 text-lg font-bold">
                  <span className="sr-only">{b.icon} </span>
                  {b.title}
                </h3>
                <p className="mt-1.5 text-slate-600">{b.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Create Form Section */}
        <section id="create" className="scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <CreateForm
              value={input}
              onChange={showErrorsCleared}
              image={image}
              onImageChange={setImage}
              errors={errors}
              loading={loading}
              onSubmit={handleGenerate}
            />

            {genError && (
              <div role="alert" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <h4 className="text-sm font-bold text-amber-900">AI Service Message</h4>
                    <p className="mt-1 text-sm text-amber-800 leading-relaxed font-mono">
                      {genError}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Results Section */}
        <div ref={resultsRef} id="results" className="scroll-mt-20">
          {loading && (
            <section className="px-4 pb-16 sm:px-6" aria-live="polite">
              <div className="mx-auto flex max-w-3xl flex-col items-center rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
                <span className="h-12 w-12 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" aria-hidden="true" />
                <p className="mt-5 text-xl font-bold text-slate-900">
                  {GENERATION_STEPS[loadingStepIdx]}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Real AI is analyzing your business and engineering 3 distinct commercial concepts.
                </p>
                <div className="mt-6 w-full max-w-sm space-y-3" aria-hidden="true">
                  <div className="h-3 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
                </div>
              </div>
            </section>
          )}

          {!loading && campaign && campaignInput && (
            <section className="px-4 pb-20 sm:px-6">
              <div className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-5 shadow-lg shadow-slate-200/60 sm:p-10">
                <Results
                  campaign={campaign}
                  input={campaignInput}
                  image={campaignImage}
                  onConceptUpdated={handleConceptUpdated}
                />
              </div>
            </section>
          )}
        </div>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-20 border-t border-slate-200 bg-white px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-3xl font-extrabold tracking-tight">How Real AI Power Works</h2>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="rounded-2xl bg-slate-50 p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 font-bold text-white">
                    {s.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-slate-600">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="scroll-mt-20 bg-white px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <div className="text-center">
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Simple plans for every stage</h2>
              <p className="mt-3 text-slate-600">Choose the AI ad allowance per billing period that fits your business.</p>
              <div className="mt-6 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1" aria-label="Pricing currency">
                {(["INR", "USD"] as Currency[]).map((choice) => (
                  <button key={choice} type="button" aria-pressed={currency === choice} onClick={() => setCurrency(choice)}
                    className={`rounded-lg px-5 py-2 text-sm font-bold ${currency === choice ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-white"}`}>
                    {choice}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-10 grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {(["free", "starter", "pro", "business"] as PlanId[]).map((plan) => {
                const details = PLAN_DETAILS[plan];
                const pricing = plans?.[plan];
                const current = billing?.plan === plan;
                const hasPaidPlan = Boolean(billing && billing.plan !== "free" && billing.status === "active");
                const price = pricing?.prices[currency];
                return (
                  <article key={plan} className={`relative flex flex-col rounded-2xl border p-6 shadow-sm ${plan === "pro" ? "border-indigo-500 ring-2 ring-indigo-500 shadow-indigo-100" : "border-slate-200"}`}>
                    {plan === "pro" && <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-indigo-600 px-4 py-1 text-xs font-extrabold uppercase tracking-wide text-white">Most Popular</span>}
                    <h3 className="text-xl font-extrabold">{details.name}</h3>
                    <p className="mt-4 flex items-baseline gap-1">
                      <span className="text-4xl font-extrabold tracking-tight text-slate-900">{price === undefined ? "…" : `${currency === "INR" ? "₹" : "$"}${price.toLocaleString(currency === "INR" ? "en-IN" : "en-US")}`}</span>
                      {plan !== "free" && <span className="text-sm text-slate-500">/billing period</span>}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-indigo-700">{pricing?.ads ?? "—"} AI ads per billing period</p>
                    <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-600">
                      {details.features.map((feature) => <li key={feature} className="flex gap-2"><span className="font-bold text-indigo-600" aria-hidden="true">✓</span><span>{feature}</span></li>)}
                    </ul>
                    <button type="button" onClick={() => void handleChoosePlan(plan)}
                      disabled={plan === "free" || (hasPaidPlan && !current) || checkoutLoading !== null}
                      className={`mt-7 w-full rounded-xl px-4 py-3 text-sm font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${current ? "border border-indigo-200 bg-indigo-50 text-indigo-800" : plan === "pro" ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-900 text-white hover:bg-slate-800"} disabled:cursor-not-allowed disabled:opacity-60`}>
                      {checkoutLoading === plan ? "Opening checkout…" : current ? "Current Plan" : plan === "free" ? "Free Plan" : details.button}
                    </button>
                    {hasPaidPlan && !current && <span className="mt-2 text-center text-xs text-slate-500">Available after this billing period</span>}
                  </article>
                );
              })}
            </div>
            <p className="mt-5 text-center text-xs text-slate-500">A paid plan covers one billing period and does not auto-renew. Purchase again after it ends to continue.</p>
            {paymentMessage && <p role="status" className="mx-auto mt-5 max-w-2xl rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-center text-sm font-medium text-indigo-900">{paymentMessage}</p>}
            {!authUser && <p className="mt-3 text-center text-sm text-slate-500">Sign in with Google to purchase a paid plan.</p>}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        <nav className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Legal">
          <a className="hover:text-indigo-700" href="/privacy-policy">Privacy Policy</a>
          <a className="hover:text-indigo-700" href="/terms">Terms &amp; Conditions</a>
          <a className="hover:text-indigo-700" href="/refund-policy">Refund/Cancellation Policy</a>
        </nav>
        <p>© 2026 AdSpark AI. All rights reserved.</p>
      </footer>
    </div>
  );
}
