export const metadata = {
  title: '4TLOmeMEMORY',
  description: 'Run memory — log sensory blocks, replay sessions, find patterns',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#080810' }}>{children}</body>
    </html>
  );
}
