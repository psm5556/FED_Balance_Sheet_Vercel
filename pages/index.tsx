import dynamic from 'next/dynamic';
import { useState } from 'react';
import Head from 'next/head';
import clsx from 'clsx';

// Lazy-load heavy tab components
const BalanceSheetTab    = dynamic(() => import('@/components/BalanceSheetTab'),    { ssr: false });
const RateSpreadsTab     = dynamic(() => import('@/components/RateSpreadsTab'),     { ssr: false });
const FearGreedHistoryTab = dynamic(() => import('@/components/FearGreedHistoryTab'), { ssr: false });

const TABS = [
  { id: 'balance',  label: '💰 Fed Balance Sheet' },
  { id: 'spreads',  label: '📈 금리 스프레드' },
  { id: 'feargreed', label: '😨 Fear & Greed 히스토리' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabId>('balance');
  const [lastUpdated] = useState(() => new Date().toLocaleString('ko-KR'));

  return (
    <>
      <Head>
        <title>Fed 모니터링 대시보드</title>
        <meta name="description" content="연준 대차대조표 · 금리 스프레드 · Fear & Greed 히스토리" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="min-h-screen bg-[#0e1117] text-white">
        {/* Top bar */}
        <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg font-bold text-white truncate">
                📊 Fed 모니터링 대시보드
              </span>
              <span className="hidden sm:inline text-xs text-gray-500 shrink-0">
                마지막 업데이트: {lastUpdated}
              </span>
            </div>
            <a
              href="https://fred.stlouisfed.org"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-blue-400 hover:text-blue-300 shrink-0"
            >
              FRED ↗
            </a>
          </div>

          {/* Tab navigation */}
          <nav className="max-w-screen-2xl mx-auto px-4 flex gap-1 pb-0">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeTab === tab.id
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-600'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </header>

        {/* Main content */}
        <main className="max-w-screen-2xl mx-auto px-4 py-6">
          {activeTab === 'balance'   && <BalanceSheetTab />}
          {activeTab === 'spreads'   && <RateSpreadsTab />}
          {activeTab === 'feargreed' && <FearGreedHistoryTab />}
        </main>

        <footer className="border-t border-gray-800 mt-12 py-4">
          <div className="max-w-screen-2xl mx-auto px-4 text-center text-xs text-gray-600">
            데이터 출처: Federal Reserve Economic Data (FRED) · CNN Business Fear &amp; Greed Index
          </div>
        </footer>
      </div>
    </>
  );
}
