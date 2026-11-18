import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const clerkAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorBackground: "var(--surface)",
    colorForeground: "var(--foreground)",
    colorMutedForeground: "var(--muted)",
    colorInput: "var(--surface)",
    colorInputForeground: "var(--foreground)",
    colorNeutral: "var(--foreground)",
    colorPrimaryForeground: "var(--primary-foreground)",
    borderRadius: "0.375rem",
  },
};

const TAGLINE = "Borrow what you need. Lend what you don't.";

export const metadata: Metadata = {
  title: { default: "LendLoop", template: "%s · LendLoop" },
  description: `${TAGLINE} A neighborhood board for lending and borrowing tools.`,
  openGraph: {
    title: "LendLoop",
    description: TAGLINE,
    siteName: "LendLoop",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <ClerkProvider appearance={clerkAppearance}>
          <ConvexClientProvider>
            <a href="#main" className="skip-link">
              Skip to main content
            </a>
            <SiteHeader />
            {/* Each page (or the signed-in layout) renders its own <Main>. */}
            <div className="flex flex-1 flex-col">{children}</div>
            <SiteFooter />
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
