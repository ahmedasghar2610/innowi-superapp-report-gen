import "./globals.css";

/*
 * The shell is deliberately empty of branding — colours, fonts, title and
 * favicon are all per-slug and come from each page instead.
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-white antialiased">{children}</body>
    </html>
  );
}
