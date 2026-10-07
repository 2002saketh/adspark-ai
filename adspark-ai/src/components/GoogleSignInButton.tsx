import { useEffect, useRef } from "react";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityApi {
  initialize: (options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
  }) => void;
  renderButton: (
    element: HTMLElement,
    options: { theme: "outline"; size: "large"; text: "signin_with"; shape: "rectangular" },
  ) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentityApi } };
  }
}

interface Props {
  clientId: string;
  onCredential: (credential: string) => void;
  onLoadError: () => void;
}

export function GoogleSignInButton({ clientId, onCredential, onLoadError }: Props) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef(onCredential);
  const loadErrorHandler = useRef(onLoadError);

  useEffect(() => {
    credentialHandler.current = onCredential;
    loadErrorHandler.current = onLoadError;
  }, [onCredential, onLoadError]);

  useEffect(() => {
    let cancelled = false;
    let script = document.querySelector<HTMLScriptElement>("script[data-google-identity]");

    const render = () => {
      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => credentialHandler.current(credential),
        auto_select: false,
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
      });
    };

    if (window.google) {
      render();
      return () => { cancelled = true; };
    }

    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = "true";
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => loadErrorHandler.current(), { once: true });
      document.head.append(script);
    } else {
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => loadErrorHandler.current(), { once: true });
    }

    return () => { cancelled = true; };
  }, [clientId]);

  return <div ref={buttonRef} className="min-h-10" aria-label="Sign in with Google" />;
}
