export type LegalPageKind = "privacy" | "terms" | "refund";

const content: Record<LegalPageKind, { title: string; sections: { heading: string; text: string }[] }> = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      { heading: "Information we use", text: "When you sign in with Google, AdSpark receives basic profile information such as your name, email address, profile image, and Google account identifier. We use it to provide your account and keep you signed in." },
      { heading: "Campaigns and AI services", text: "The business details, offers, and images you submit are processed to generate campaign copy and visuals using Cloudflare Workers AI. AdSpark's database stores account, session, usage, billing, and payment-order records; it does not store generated campaign content." },
      { heading: "Payments and service providers", text: "Razorpay processes payments. AdSpark stores payment-order and plan-status information needed to confirm purchases and provide paid features. AdSpark does not store your card or bank credentials. Google, Cloudflare, and Razorpay process information under their own privacy terms." },
      { heading: "Your choices and security", text: "You can stop using the service and sign out at any time. We use reasonable safeguards to protect account and billing records, but no online service can guarantee absolute security. Contact details for payment support are available on your Razorpay receipt." },
    ],
  },
  terms: {
    title: "Terms & Conditions",
    sections: [
      { heading: "Using AdSpark", text: "AdSpark helps you create advertising copy, campaign concepts, and visuals. You are responsible for the information you submit and for reviewing generated content before publishing it." },
      { heading: "Your content and responsibilities", text: "Only submit content you have the right to use. You must check generated claims, prices, promotions, images, and other material for accuracy and compliance with laws and platform rules. AI output may be incomplete or incorrect and is not a guarantee of advertising results." },
      { heading: "Plans and payments", text: "Paid plans provide the features and usage allowance shown at checkout for one billing period. Plans do not automatically renew. Payment is processed by Razorpay, and paid features are activated after payment is verified." },
      { heading: "Acceptable use and availability", text: "Do not use AdSpark to violate the law, infringe another person's rights, or interfere with the service. We may restrict use that creates security or operational risks. The service is provided as available and may be updated or temporarily unavailable." },
    ],
  },
  refund: {
    title: "Refund/Cancellation Policy",
    sections: [
      { heading: "Cancellation", text: "AdSpark plans are one-time purchases for a billing period and do not automatically renew. There is no recurring subscription to cancel. You can stop using the service at any time; paid access remains available through the period already purchased." },
      { heading: "Refunds", text: "Because paid features are made available after a verified purchase, payments are generally non-refundable once the plan has been activated, except where required by law. We will review duplicate charges, failed payments, or cases where a verified payment did not activate the purchased plan." },
      { heading: "Payment issues", text: "For help with a charge or refund request, use the support details on your Razorpay receipt and include the payment reference. Never send card details, passwords, or session credentials in a support request." },
    ],
  },
};

const links: { href: string; label: string }[] = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/refund-policy", label: "Refund/Cancellation Policy" },
];

export default function LegalPage({ page }: { page: LegalPageKind }) {
  const pageContent = content[page];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <a href="/" className="text-lg font-extrabold tracking-tight text-slate-900">AdSpark AI</a>
          <a href="/" className="text-sm font-semibold text-indigo-700 hover:text-indigo-900">Back to AdSpark</a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:py-16">
        <p className="text-sm font-semibold text-indigo-700">AdSpark AI · Policies</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{pageContent.title}</h1>
        <p className="mt-3 text-sm text-slate-500">Last updated: October 7, 2026</p>
        <div className="mt-10 space-y-8">
          {pageContent.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-bold">{section.heading}</h2>
              <p className="mt-2 leading-7 text-slate-600">{section.text}</p>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-7 text-center text-sm text-slate-500">
        <nav className="mb-3 flex flex-wrap justify-center gap-x-5 gap-y-2" aria-label="Legal">
          {links.map((link) => <a key={link.href} className="hover:text-indigo-700" href={link.href}>{link.label}</a>)}
        </nav>
        <p>© 2026 AdSpark AI. All rights reserved.</p>
      </footer>
    </div>
  );
}
