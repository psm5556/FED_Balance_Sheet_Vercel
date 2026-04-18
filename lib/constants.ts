import type { SeriesInfoItem, SpreadInfo } from './types';

// ── Balance Sheet Series ──────────────────────────────────────────────────
export const SERIES_INFO: Record<string, SeriesInfoItem> = {
  '총자산 (Total Assets)': {
    id: 'WALCL', highlight: true, category: '자산 (Assets)',
    description: '연준의 전체 자산 규모', liquidityImpact: '증가 시 시장 유동성 ↑',
    order: 1, showChart: true,
  },
  '연준 보유 증권 (Securities Held)': {
    id: 'WSHOSHO', highlight: false, category: '자산 (Assets)',
    description: '연준이 보유한 국채 및 MBS', liquidityImpact: '증가 시 시장 유동성 ↑',
    order: 2, showChart: false,
  },
  'SRF (상설레포)': {
    id: 'RPONTSYD', highlight: true, category: '자산 (Assets)',
    description: '은행에 제공하는 단기 대출', liquidityImpact: '증가 시 은행 유동성 ↑',
    order: 3, showChart: true,
  },
  '대출 (Loans)': {
    id: 'WLCFLL', highlight: false, category: '자산 (Assets)',
    description: '연준의 금융기관 대출', liquidityImpact: '증가 시 시장 유동성 ↑',
    order: 4, showChart: false,
  },
  '  ㄴ Primary Credit': {
    id: 'WLCFLPCL', highlight: true, category: '자산 (Assets)',
    description: '할인창구 1차 신용대출', liquidityImpact: '증가 시 은행 유동성 ↑',
    order: 5, showChart: true,
  },
  '  ㄴ Secondary Credit': {
    id: 'WLCFLSCL', highlight: false, category: '자산 (Assets)',
    description: '할인창구 2차 신용대출', liquidityImpact: '증가 시 은행 유동성 ↑',
    order: 6, showChart: false,
  },
  '  ㄴ Seasonal Credit': {
    id: 'WLCFLSECL', highlight: false, category: '자산 (Assets)',
    description: '할인창구 계절성 신용대출', liquidityImpact: '증가 시 은행 유동성 ↑',
    order: 7, showChart: false,
  },
  '지급준비금 (Reserve Balances)': {
    id: 'WRBWFRBL', highlight: true, category: '부채 (Liabilities)',
    description: '은행들이 연준에 예치한 자금', liquidityImpact: '증가 시 은행 유동성 ↑',
    order: 8, showChart: true,
  },
  'TGA (재무부 일반계정)': {
    id: 'WDTGAL', highlight: true, category: '부채 (Liabilities)',
    description: '미 재무부의 연준 예금', liquidityImpact: '증가 시 시장 유동성 ↓',
    order: 9, showChart: true,
  },
  'RRP (역레포)': {
    id: 'RRPONTSYD', highlight: true, category: '부채 (Liabilities)',
    description: 'MMF 등의 초단기 자금 흡수', liquidityImpact: '증가 시 시장 유동성 ↓',
    order: 10, showChart: true,
  },
  'MMF (Money Market Funds)': {
    id: 'ICI_MMF', highlight: true, category: '부채 (Liabilities)',
    description: '머니마켓펀드 총 자산 (주간, ICI)', liquidityImpact: '증가 시 현금 보유 선호 ↑',
    order: 11, showChart: true, apiSource: 'ici',
  },
  'Retail MMF': {
    id: 'WRMFNS', highlight: false, category: '부채 (Liabilities)',
    description: '개인투자자용 머니마켓펀드', liquidityImpact: '증가 시 현금 보유 선호 ↑',
    order: 12, showChart: false,
  },
};

// ── Rate Spreads ──────────────────────────────────────────────────────────
export const SPREADS: Record<string, SpreadInfo> = {
  'SOFR-IORB': {
    name: 'SOFR - IORB', series: ['SOFR', 'IORB'], multiplier: 1000,
    thresholdMin: -10, thresholdMax: -5,
    description: '시중 은행의 지급준비금 여유도 및 단기 자금 시장의 병목 현상 측정', normalRange: '-10bp ~ -5bp',
    interpretation: '스프레드 확대(SOFR→IORB 근접/상회): 유동성 경색 신호 — 국채 발행 과다 또는 지급준비금 부족 시 발생 / 골든존(-10~-5bp): SOFR이 IORB보다 약간 낮게 안정 유지 (정상) / 스프레드 축소(SOFR↘): 유동성 과잉 신호 — RRP 잔액 증가 시 주로 나타남',
    signals: {
      tight:  { min: -5,        max: Infinity, message: '📈 레포시장 타이트 - 단기 자금 및 담보 수요 지표' },
      normal: { min: -10,       max: -5,       message: '✅ 골든존 - SOFR이 IORB보다 약간 낮게 안정 유지' },
      loose:  { min: -Infinity, max: -10,      message: '💧 유동성 과잉 - RRP 잔액 증가 시 주로 나타남' },
    },
  },
  'EFFR-IORB': {
    name: 'EFFR - IORB', series: ['EFFR', 'IORB'], multiplier: 1000,
    thresholdMin: -10, thresholdMax: 10,
    description: '연준 금리 통제력', normalRange: '-10 ~ +10bp',
    interpretation: '양수: 준비금 부족/유동성 타이트 / 음수: 초과 준비금/유동성 풍부',
    signals: {
      tight:  { min: 10,        max: Infinity,  message: '⚠️ 초단기 유동성 타이트 - 준비금 부족' },
      normal: { min: -10,       max: 10,         message: '✅ 정상 범위 (정책 운용 변동 포함)' },
      loose:  { min: -Infinity, max: -10,        message: '💧 초과 준비금 (유동성 풍부)' },
    },
  },
  'SOFR-RRP': {
    name: 'SOFR - RRP', series: ['SOFR', 'RRPONTSYAWARD'], multiplier: 1000,
    thresholdMin: 0, thresholdMax: 10,
    description: '민간 담보시장 vs 연준 유동성 흡수', normalRange: '0 ~ +10bp',
    interpretation: '양수: 정상 / >10bp: 담보 부족/레포시장 긴장 / 음수: 비정상',
    signals: {
      stress:   { min: 10,        max: Infinity, message: '⚠️ 레포시장 스트레스 - 담보 부족' },
      normal:   { min: 0,         max: 10,       message: '✅ 보통 변동' },
      abnormal: { min: -Infinity, max: 0,        message: '🔍 비정상 - 데이터/정책 확인 필요' },
    },
  },
  'DGS3MO-EFFR': {
    name: '3M Treasury - EFFR', series: ['DGS3MO', 'EFFR'], multiplier: 100,
    thresholdMin: -20, thresholdMax: 20,
    description: '단기 금리 기대 및 정책 방향 신호', normalRange: '-20 ~ +20bp',
    interpretation: '<-20bp: 금리 인하 예상 / 중립: 균형 / >20bp: 금리 인상 기대',
    signals: {
      easing:     { min: -Infinity, max: -20, message: '🔽 금리 인하 예상 (완화 기대)' },
      neutral:    { min: -20,       max: 20,  message: '✅ 중립 (명확한 기대 신호 없음)' },
      tightening: { min: 20,        max: Infinity, message: '🔼 금리 인상 기대 (긴축 신호)' },
    },
  },
  'DGS10-DGS2': {
    name: '10Y - 2Y Yield Curve', series: ['DGS10', 'DGS2'], multiplier: 100,
    thresholdMin: 0, thresholdMax: 50,
    description: '경기 사이클 신호 (전통적 침체 지표)', normalRange: '0 ~ +50bp',
    interpretation: '음수(역전): 경기침체 신호 / 0~50bp: 정상 / >50bp: 가파른 성장 기대',
    signals: {
      severe_inversion: { min: -Infinity, max: -50, message: '🚨 강한 침체 리스크' },
      mild_inversion:   { min: -50,       max: 0,   message: '⚠️ 곡선 역전 - 경기침체 경고' },
      normal:           { min: 0,         max: 50,  message: '✅ 정상 (완만한 우상향)' },
      steep:            { min: 50,        max: Infinity, message: '📈 가파른 곡선 (강한 성장/인플레 기대)' },
    },
  },
  'DGS10-DGS3MO': {
    name: '10Y - 3M Yield Curve', series: ['DGS10', 'DGS3MO'], multiplier: 100,
    thresholdMin: 0, thresholdMax: 100,
    description: '정책 신뢰 기반 침체 지표', normalRange: '0 ~ +100bp',
    interpretation: '<-50bp: 매우 강한 침체 신호 / 0~100bp: 정상 / >100bp: 장단기 프리미엄',
    signals: {
      strong_recession:  { min: -Infinity, max: -50,  message: '🚨 매우 강한 침체 선행 신호' },
      recession_warning: { min: -50,       max: 0,    message: '⚠️ 침체 우려 레벨' },
      normal:            { min: 0,         max: 100,  message: '✅ 정상-완만' },
      steep:             { min: 100,       max: Infinity, message: '📈 장단기 프리미엄 (성장/인플레 기대)' },
    },
  },
  'STLFSI4': {
    name: '금융 스트레스 인덱스', series: ['STLFSI4'], multiplier: 1,
    thresholdMin: -0.5, thresholdMax: 0.5, isSingleSeries: true, showMa: true,
    description: '세인트루이스 연준 금융 스트레스 지표', normalRange: '-0.5 ~ +0.5',
    interpretation: '0 기준: 평균 스트레스 / 양수: 스트레스 증가 / 음수: 스트레스 감소',
    signals: {
      severe_stress:   { min: 1.5,        max: Infinity, message: '🚨 심각한 금융 스트레스' },
      elevated_stress: { min: 0.5,        max: 1.5,      message: '⚠️ 높은 스트레스' },
      normal:          { min: -0.5,       max: 0.5,      message: '✅ 정상 범위' },
      low_stress:      { min: -Infinity,  max: -0.5,     message: '💚 낮은 스트레스' },
    },
  },
  'DRTSCILM': {
    name: '은행 대출 기준 (SLOOS)', series: ['DRTSCILM'], multiplier: 1,
    thresholdMin: 0, thresholdMax: 20, isSingleSeries: true, showMa: false,
    description: '은행 대출 기준 강화 비율 (위기 선행지표)', normalRange: '0 ~ +20%',
    interpretation: '높을수록 은행들이 대출 기준을 강화 → 신용 경색 우려 / 낮을수록 대출 여건 개선',
    signals: {
      severe_tightening: { min: 50,        max: Infinity, message: '🚨 극심한 대출 긴축 - 위기 임박 신호' },
      tightening:        { min: 20,        max: 50,       message: '⚠️ 대출 기준 강화 - 신용 경색 우려' },
      normal:            { min: 0,         max: 20,       message: '✅ 보통 수준' },
      easing:            { min: -Infinity, max: 0,        message: '💚 대출 기준 완화' },
    },
  },
};

// ── Policy Rate Series ────────────────────────────────────────────────────
export const POLICY_SERIES: Record<string, string> = {
  SOFR: '담보부 익일물 금리',
  RRPONTSYAWARD: 'ON RRP (하한)',
  IORB: '준비금 이자율',
  EFFR: '연방기금 실효금리',
  DFEDTARL: 'FF 목표 하한',
  DFEDTARU: 'FF 목표 상한',
};

export const POLICY_COLORS: Record<string, string> = {
  SOFR: '#FF6B6B',
  RRPONTSYAWARD: '#4ECDC4',
  IORB: '#95E1D3',
  EFFR: '#F38181',
  DFEDTARL: 'rgba(200,200,200,0.4)',
  DFEDTARU: 'rgba(200,200,200,0.4)',
};

// ── Period options ─────────────────────────────────────────────────────────
export const PERIOD_OPTIONS = [
  { label: '1개월', days: 30 },
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
  { label: '1년',   days: 365 },
  { label: '2년',   days: 730 },
  { label: '5년',   days: 1825 },
];

export const PERIOD_OPTIONS_LONG = [
  ...PERIOD_OPTIONS,
  { label: '10년',  days: 3650 },
  { label: '전체',  days: 365 * 20 },
];

export const FG_PERIOD_OPTIONS = [
  { label: '3개월', days: 90 },
  { label: '6개월', days: 180 },
  { label: '1년',   days: 365 },
  { label: '2년',   days: 730 },
  { label: '3년',   days: 1095 },
  { label: '5년',   days: 1825 },
  { label: '전체',  days: null },
];
