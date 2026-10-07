import type { AdInput, AdPackage, BusinessType, PosterContent, RegenerableSection, Tone } from "../types";

/**
 * Deterministic, template-based generator. Same input + same variant => same output.
 * Increasing `variant` rotates through alternative phrasings (used by "Regenerate").
 */

interface TypeProfile {
  tagline: string;
  posterCta: string;
  ctaSentence: string;
  ctas: [string, string, string];
  perk: string;
  question: string;
  headlineBenefit: string;
  hashtags: string[];
}

const PROFILES: Record<BusinessType, TypeProfile> = {
  Salon: {
    tagline: "Look Better. Feel Better.",
    posterCta: "BOOK NOW",
    ctaSentence: "Book your appointment today.",
    ctas: ["Book Your Appointment", "Claim This Offer", "Message Us Today"],
    perk: "a fresh new look without breaking the budget",
    question: "Would you like me to help you book an appointment?",
    headlineBenefit: "Look Your Best Without Breaking the Bank",
    hashtags: ["#salon", "#haircare", "#beautytips", "#glowup"],
  },
  Restaurant: {
    tagline: "Taste That Brings You Back.",
    posterCta: "RESERVE A TABLE",
    ctaSentence: "Reserve your table today.",
    ctas: ["Reserve Your Table", "Claim This Offer", "Message Us Today"],
    perk: "a great meal with people you love",
    question: "Shall I reserve a table for you?",
    headlineBenefit: "Great Food. Better Moments.",
    hashtags: ["#foodie", "#restaurant", "#foodlovers", "#diningout"],
  },
  Gym: {
    tagline: "Stronger Starts Today.",
    posterCta: "JOIN TODAY",
    ctaSentence: "Join us today and start your journey.",
    ctas: ["Join Today", "Claim This Offer", "Message Us Today"],
    perk: "building a stronger, healthier you",
    question: "Want me to set up a time for you to visit the gym?",
    headlineBenefit: "Your Fitness Journey Starts Here",
    hashtags: ["#gym", "#fitness", "#workout", "#fitnessmotivation"],
  },
  "Real Estate": {
    tagline: "Your Dream Home Awaits.",
    posterCta: "BOOK A VISIT",
    ctaSentence: "Book a site visit today.",
    ctas: ["Book a Site Visit", "Get Details Today", "Message Us Today"],
    perk: "finding a place you will be proud to call home",
    question: "Would you like to schedule a site visit?",
    headlineBenefit: "Find the Home You Have Been Waiting For",
    hashtags: ["#realestate", "#property", "#dreamhome", "#homebuying"],
  },
  "Dental Clinic": {
    tagline: "Smile With Confidence.",
    posterCta: "BOOK A CHECK-UP",
    ctaSentence: "Book your check-up today.",
    ctas: ["Book Your Check-Up", "Claim This Offer", "Message Us Today"],
    perk: "a healthy, confident smile",
    question: "Would you like me to book you a slot?",
    headlineBenefit: "A Healthier Smile Starts Here",
    hashtags: ["#dentist", "#dentalcare", "#smile", "#oralhealth"],
  },
  "Clothing Store": {
    tagline: "Style That Fits You.",
    posterCta: "SHOP NOW",
    ctaSentence: "Visit the store or message us to shop.",
    ctas: ["Shop Now", "Claim This Offer", "Message Us Today"],
    perk: "refreshing your wardrobe with pieces you will love",
    question: "Want me to send you photos of what is available?",
    headlineBenefit: "Fresh Styles at Prices You Will Love",
    hashtags: ["#fashion", "#style", "#ootd", "#shopping"],
  },
  Cafe: {
    tagline: "Good Coffee. Good Mood.",
    posterCta: "VISIT US TODAY",
    ctaSentence: "Drop by today.",
    ctas: ["Visit Us Today", "Claim This Offer", "Message Us Today"],
    perk: "a cosy break and something delicious",
    question: "Shall I save you a table?",
    headlineBenefit: "Your Daily Break Just Got Better",
    hashtags: ["#cafe", "#coffeelovers", "#coffeetime", "#brunch"],
  },
  "Interior Design": {
    tagline: "Spaces You Will Love.",
    posterCta: "GET A FREE QUOTE",
    ctaSentence: "Get in touch for a consultation.",
    ctas: ["Get a Quote", "Claim This Offer", "Message Us Today"],
    perk: "turning your space into somewhere you love being",
    question: "Would you like a quick call to talk about your space?",
    headlineBenefit: "Turn Your Space Into Something Special",
    hashtags: ["#interiordesign", "#homedecor", "#homeinspo", "#interiors"],
  },
  Other: {
    tagline: "Quality You Can Trust.",
    posterCta: "GET IN TOUCH",
    ctaSentence: "Message us today.",
    ctas: ["Get in Touch", "Claim This Offer", "Message Us Today"],
    perk: "great value from a business you can trust",
    question: "Would you like to know more?",
    headlineBenefit: "Quality and Value, Together",
    hashtags: ["#smallbusiness", "#supportlocal", "#offer"],
  },
};

const IG_OPENERS: Record<Tone, string[]> = {
  Exciting: [
    "🔥 Big news from {biz}!",
    "✨ Get ready — something special is here!",
    "🎉 Treat yourself, you deserve it!",
  ],
  Friendly: [
    "Hey {place}! 👋 We have something nice for you.",
    "Good things are happening at {biz} 😊",
    "Your day just got a little better ✨",
  ],
  Professional: [
    "Introducing {svc} at {biz}.",
    "Quality {svc}, delivered by experienced professionals.",
    "{biz} presents a new offer on {svc}.",
  ],
  Luxury: [
    "Indulge in the extraordinary.",
    "Elevate your experience with {biz}.",
    "Refined. Exclusive. Yours.",
  ],
  Urgent: [
    "⏰ Limited time only at {biz}!",
    "🚨 Do not miss out — this offer will not last!",
    "Only for a short time — grab yours today!",
  ],
};

const WA_OPENERS: Record<Tone, string[]> = {
  Exciting: [
    "We are running a special offer at {biz} and I thought of you!",
    "Something exciting is happening at {biz} right now.",
    "We just launched a new offer at {biz}.",
  ],
  Friendly: [
    "Hope you are doing well! We are running a little offer at {biz}.",
    "Just wanted to share a nice offer from {biz}.",
    "We have a special offer at {biz} this week.",
  ],
  Professional: [
    "We are pleased to share a current offer at {biz}.",
    "{biz} is offering a special rate on {svc}.",
    "We have a new offer available at {biz}.",
  ],
  Luxury: [
    "We are delighted to extend an exclusive offer from {biz}.",
    "A little something special from {biz}, just for you.",
    "{biz} is pleased to invite you to an exclusive offer.",
  ],
  Urgent: [
    "Quick heads-up: we have a limited-time offer at {biz}.",
    "I wanted you to hear about this first — our offer at {biz} ends soon.",
    "A short-time offer is live at {biz}.",
  ],
};

const HEADLINE_TWISTS: Record<Tone, (x: string, svc: string) => string> = {
  Exciting: (x) => `${x} — Do Not Miss It!`,
  Friendly: (x) => x,
  Professional: (x) => x,
  Luxury: (_x, svc) => `Experience ${svc}, Elevated`,
  Urgent: (x) => `Last Chance: ${x}`,
};

/* ----------------------------- helpers ------------------------------ */

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(arr: readonly T[], seed: number, variant: number): T {
  return arr[(seed + variant) % arr.length];
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

function toTag(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return cleaned ? `#${cleaned}` : "";
}

/** Lower-cases a leading capital so a phrase reads naturally mid-sentence ("Women aged…" -> "women aged…"). Keeps acronyms. */
function softCase(text: string): string {
  const t = text.replace(/[.!\s]+$/, "");
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface ParsedOffer {
  price: string;
  percent: string;
  raw: string;
}

function parseOffer(offer: string): ParsedOffer {
  const raw = offer.trim();
  const pct = raw.match(/(\d{1,3})\s*%/);
  const price = raw.match(/(?:₹|rs\.?|inr|\$|€|£)\s?\d[\d,]*(?:\.\d+)?/i);
  return {
    raw,
    percent: pct ? `${pct[1]}%` : "",
    price: price ? price[0].replace(/\s+/g, "") : "",
  };
}

function parsePlace(target: string): string {
  const m = target.match(/\b(?:in|at|around|near)\s+([\p{L}][\p{L}\s.-]{1,40})$/u);
  return m ? m[1].trim() : "";
}

function offerSentence(o: ParsedOffer, svc: string, seed: number, variant: number): string {
  if (o.price && o.percent) {
    return pick(
      [
        `Get our ${svc} package for just ${o.price} — that is ${o.percent} OFF.`,
        `${cap(svc)} for just ${o.price}, with ${o.percent} OFF.`,
        `Enjoy ${svc} at ${o.price} and save ${o.percent}.`,
      ],
      seed,
      variant,
    );
  }
  if (o.price) {
    return pick(
      [
        `Get our ${svc} package for just ${o.price}.`,
        `${cap(svc)} at just ${o.price}.`,
        `Enjoy ${svc} starting at ${o.price}.`,
      ],
      seed,
      variant,
    );
  }
  if (o.percent) {
    return pick(
      [`Enjoy ${o.percent} OFF on ${svc}.`, `Save ${o.percent} on ${svc}.`, `${cap(svc)} now at ${o.percent} OFF.`],
      seed,
      variant,
    );
  }
  if (o.raw) {
    const trimmed = o.raw.replace(/[.!\s]+$/, "");
    return pick([`${cap(svc)} — ${trimmed}.`, `Our offer: ${trimmed} on ${svc}.`, `${cap(trimmed)} on ${svc}.`], seed, variant);
  }
  return pick([`Discover our ${svc}.`, `Try our ${svc} today.`, `Experience our ${svc}.`], seed, variant);
}

function offerShort(o: ParsedOffer): string {
  if (o.price && o.percent) return `${o.price} (${o.percent} OFF)`;
  return o.price || (o.percent ? `${o.percent} OFF` : o.raw);
}

/* ---------------------------- generators ---------------------------- */

interface Ctx {
  input: AdInput;
  profile: TypeProfile;
  offer: ParsedOffer;
  place: string;
  seed: number;
  vars: Record<string, string>;
}

function buildCtx(input: AdInput): Ctx {
  const offer = parseOffer(input.offer);
  const place = parsePlace(input.target);
  const profile = PROFILES[input.businessType];
  const seed = hash(
    [input.businessName, input.businessType, input.product, input.offer, input.target, input.tone].join("|"),
  );
  return {
    input,
    profile,
    offer,
    place,
    seed,
    vars: { biz: input.businessName, svc: input.product, place: place || "there" },
  };
}

function genInstagram(c: Ctx, variant: number): string {
  const opener = fill(pick(IG_OPENERS[c.input.tone], c.seed, variant), c.vars);
  const offerLine = offerSentence(c.offer, c.input.product, c.seed + 1, variant);
  const audience = c.input.target
    ? `Made for ${softCase(c.input.target)} — perfect for ${c.profile.perk}.`
    : `Perfect for anyone looking for ${c.profile.perk}.`;
  const tags = Array.from(
    new Set([...c.profile.hashtags, toTag(c.input.businessName), c.place ? toTag(c.place) : "", "#LocalBusiness"].filter(Boolean)),
  ).join(" ");
  return [
    opener,
    offerLine,
    audience,
    `${c.place ? `📍 ${c.place}\n` : ""}📲 ${c.profile.ctaSentence}`,
    tags,
  ].join("\n\n");
}

function genWhatsApp(c: Ctx, variant: number): string {
  const opener = fill(pick(WA_OPENERS[c.input.tone], c.seed + 2, variant), c.vars);
  const offerLine = offerSentence(c.offer, c.input.product, c.seed + 3, variant);
  return ["Hi! 👋", opener, offerLine, c.profile.question].join("\n\n");
}

function genHeadlines(c: Ctx): string[] {
  const { input, offer, profile, place } = c;
  const svc = input.product;
  let base: string;
  if (offer.price) base = `${svc} at ${offer.price}`;
  else if (offer.percent) base = `${offer.percent} Off ${svc}`;
  else if (offer.raw) base = cap(offer.raw.replace(/[.!\s]+$/, ""));
  else base = `Discover ${svc}`;
  const first = HEADLINE_TWISTS[input.tone](base, svc);
  const second = profile.headlineBenefit;
  const third = place ? `Special ${svc} Offer in ${place}` : `Special ${svc} Offer at ${input.businessName}`;
  return [first, second, third];
}

function genCtas(c: Ctx): string[] {
  const ctas = [...c.profile.ctas];
  if (c.input.tone === "Urgent") ctas[1] = "Claim Before It Ends";
  if (c.input.tone === "Luxury") ctas[1] = "Reserve Your Experience";
  return ctas;
}

function genAdCopy(c: Ctx, variant: number): string {
  const headlines = genHeadlines(c);
  const headline = headlines[variant % headlines.length];
  const short = offerShort(c.offer);
  const audience = c.input.target ? ` Made for ${softCase(c.input.target)}.` : "";
  const primary = pick(
    [
      `${cap(c.input.product)} at ${c.input.businessName}${short ? ` — ${short}` : ""}.${audience} ${c.profile.ctaSentence}`,
      `${c.input.businessName} is offering ${c.input.product}${short ? ` for ${short}` : ""}.${audience} ${c.profile.ctaSentence}`,
      `${offerSentence(c.offer, c.input.product, c.seed + 4, variant)}${audience} ${c.profile.ctaSentence}`,
    ],
    c.seed + 5,
    variant,
  );
  return [
    `Headline: ${headline}`,
    `Primary text: ${primary}`,
    `Description: ${c.profile.tagline}`,
    `Button: ${genCtas(c)[0]}`,
  ].join("\n");
}

function genPoster(c: Ctx): PosterContent {
  const { offer, input, profile, place } = c;
  let mainOffer: string;
  if (offer.percent) mainOffer = `${offer.percent} OFF`;
  else if (offer.price) mainOffer = offer.price;
  else if (offer.raw) mainOffer = offer.raw.toUpperCase();
  else mainOffer = "SPECIAL OFFER";
  const priceLine = offer.percent && offer.price ? `Just ${offer.price}` : "";
  return {
    businessName: input.businessName,
    mainOffer,
    priceLine,
    service: input.product,
    benefit: profile.tagline,
    cta: profile.posterCta,
    location: place,
    businessType: input.businessType,
  };
}

/* ------------------------------ public ------------------------------ */

export function mockGenerateAdPackage(input: AdInput): AdPackage {
  const c = buildCtx(input);
  return {
    instagram: genInstagram(c, 0),
    whatsapp: genWhatsApp(c, 0),
    adCopy: genAdCopy(c, 0),
    headlines: genHeadlines(c),
    ctas: genCtas(c),
    poster: genPoster(c),
    source: "mock",
  };
}

export function mockRegenerateSection(input: AdInput, section: RegenerableSection, variant: number): string {
  const c = buildCtx(input);
  switch (section) {
    case "instagram":
      return genInstagram(c, variant);
    case "whatsapp":
      return genWhatsApp(c, variant);
    case "adCopy":
      return genAdCopy(c, variant);
    default:
      return genInstagram(c, variant);
  }
}
