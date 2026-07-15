import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import './globals.css';

/*
 * Font-loading strategy (BRAND §3): both families are loaded with
 * `next/font/google`, which downloads and self-hosts the woff2 files at BUILD
 * time (no runtime network fetch, no layout-shift, no CSP/link tag needed). The
 * generated CSS variables (--font-hanken / --font-jetbrains) are consumed by the
 * @theme font tokens in globals.css.
 *
 * If a build environment ever blocks Google's font mirror, swap these two calls
 * for `next/font/local` pointing at self-hosted woff2 in app/fonts — the theme
 * variables stay the same, so nothing else changes.
 */
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-hanken',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'EVM Nexus',
  description: 'Operator console + smart-contract toolkit for test EVM chains.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${hanken.variable} ${jetbrainsMono.variable}`} data-theme="dark">
      <head>
        {/*
          §4 Material Symbols Outlined — the icon font. Loaded as a stylesheet
          link (it is a runtime-only decorative resource, so it never blocks the
          build). Preconnect keeps first paint snappy.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
